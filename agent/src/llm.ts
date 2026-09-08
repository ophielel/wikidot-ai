import type { LlmSettings } from './config';
import { installProxyFetch } from './net';

export interface LlmToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface LlmToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

export interface LlmUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface LlmChatResult {
  message: LlmMessage;
  usage: LlmUsage;
  finishReason: string | null;
}

export interface LlmChatOptions {
  messages: LlmMessage[];
  tools?: LlmToolSchema[];
  signal?: AbortSignal;
}

/** Anything that can answer an OpenAI-style chat request. Lets tests inject a fake. */
export interface ChatClient {
  chat(options: LlmChatOptions): Promise<LlmChatResult>;
}

export class LlmError extends Error {
  public readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

interface RawChoice {
  message?: {
    role?: string;
    content?: string | null;
    tool_calls?: Array<{
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string;
}

interface RawResponse {
  choices?: RawChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Minimal OpenAI-compatible chat-completions client.
 *
 * Works with OpenAI, DeepSeek, OpenRouter, Groq, LM Studio, Ollama's
 * OpenAI endpoint and anything else exposing `/chat/completions`.
 */
export class LlmClient implements ChatClient {
  public readonly config: LlmSettings;

  constructor(config: LlmSettings) {
    this.config = config;
  }

  get model(): string {
    if (!this.config.model) {
      throw new LlmError(
        'No LLM model configured. Set "llm.model" in the config file or WIKIDOT_AI_LLM_MODEL / OPENAI_MODEL.'
      );
    }
    return this.config.model;
  }

  async chat(options: LlmChatOptions): Promise<LlmChatResult> {
    installProxyFetch();
    if (!this.config.apiKey) {
      throw new LlmError(
        'No LLM API key configured. Set "llm.apiKey" in the config file or WIKIDOT_AI_LLM_API_KEY / OPENAI_API_KEY.'
      );
    }
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.model,
      messages: options.messages,
      temperature: this.config.temperature,
    };
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
      body.tool_choice = 'auto';
    }
    if (this.config.maxTokens !== null) {
      body.max_tokens = this.config.maxTokens;
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (options.signal?.aborted) throw new LlmError('Request aborted.');
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: options.signal,
        });

        const text = await response.text();
        if (!response.ok) {
          const detail = extractError(text);
          const error = new LlmError(
            `LLM request failed (${response.status}): ${detail}`,
            response.status
          );
          if (RETRYABLE_STATUS.has(response.status) && attempt < 2) {
            lastError = error;
            await sleep(500 * 2 ** attempt);
            continue;
          }
          throw error;
        }

        let parsed: RawResponse;
        try {
          parsed = JSON.parse(text) as RawResponse;
        } catch {
          throw new LlmError(`LLM returned invalid JSON: ${text.slice(0, 300)}`);
        }

        const choice = parsed.choices?.[0];
        if (!choice?.message) {
          throw new LlmError(`LLM returned no message: ${text.slice(0, 300)}`);
        }
        const raw = choice.message;
        const toolCalls: LlmToolCall[] = (raw.tool_calls ?? []).map((call, index) => ({
          id: call.id ?? `call_${index}`,
          type: 'function',
          function: {
            name: call.function?.name ?? '',
            arguments: call.function?.arguments ?? '{}',
          },
        }));

        return {
          message: {
            role: 'assistant',
            content: raw.content ?? null,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          },
          usage: {
            promptTokens: parsed.usage?.prompt_tokens ?? null,
            completionTokens: parsed.usage?.completion_tokens ?? null,
            totalTokens: parsed.usage?.total_tokens ?? null,
          },
          finishReason: choice.finish_reason ?? null,
        };
      } catch (error) {
        if (error instanceof LlmError) throw error;
        if (error instanceof Error && error.name === 'AbortError') {
          throw new LlmError('Request aborted.');
        }
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < 2) {
          await sleep(500 * 2 ** attempt);
        }
      }
    }
    throw new LlmError(`LLM request failed: ${lastError?.message ?? 'unknown error'}`);
  }
}

function extractError(text: string): string {
  try {
    const parsed = JSON.parse(text) as RawResponse;
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // fall through
  }
  return text.slice(0, 300) || '(empty response)';
}
