import { parseNaturalLanguageFilter, type ParsedNLFilter } from '@nexaops/shared';

const FILTER_SYSTEM = `You convert Portuguese/English natural language device filters into JSON.
Return ONLY valid JSON with optional keys:
status (ONLINE|OFFLINE|UNKNOWN), type (PC|SERVER|MOBILE|NETWORK),
search (string), offline (bool), hasAlerts (bool), hasPatches (bool), rebootPending (bool).
Omit unknown keys.`;

export async function parseFilterWithLlm(query: string): Promise<ParsedNLFilter> {
  const cleaned = query.replace(/^@ai\s*/i, '').trim();
  if (!cleaned) return {};

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return parseNaturalLanguageFilter(cleaned);
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0,
        messages: [
          { role: 'system', content: FILTER_SYSTEM },
          { role: 'user', content: cleaned },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      return parseNaturalLanguageFilter(cleaned);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return parseNaturalLanguageFilter(cleaned);

    const parsed = JSON.parse(content) as ParsedNLFilter;
    return parsed;
  } catch {
    return parseNaturalLanguageFilter(cleaned);
  }
}

export async function chatAssist(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return (
      'Assistente local (sem OPENAI_API_KEY): descreva tickets, alertas ou scripts com mais detalhes. ' +
      `Você perguntou: "${prompt.slice(0, 200)}"`
    );
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content:
            'Você é o assistente NexaOps (RMM/PSA). Responda em português de forma objetiva e útil para MSPs.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content?.trim() || 'Sem resposta da IA.';
}
