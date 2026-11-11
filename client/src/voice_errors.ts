const messages: Record<string, string> = {
  authentication: 'OpenAI could not authenticate the server. Check its API key.',
  quota: 'OpenAI reports an API quota or billing limit. Check the API project billing and limits.',
  rate_limit: 'OpenAI rate limit reached. Wait a little before trying again.',
  rate_or_quota: 'OpenAI rejected the connection with a rate or quota limit. Check the API project limits.',
  model_access: 'OpenAI denied access to the configured model. Check model access and key permissions.',
  configuration: 'OpenAI rejected the voice session settings. The app configuration needs checking.',
  provider: 'OpenAI reported a service error. Please try again later.',
  connection: 'The voice server could not maintain its connection to OpenAI. Please try again.',
  unknown: 'OpenAI reported a voice error. Use the reference below to check the server logs.',
};

export function voiceErrorMessage(error: unknown): string {
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const kind = typeof value.kind === 'string' && Object.prototype.hasOwnProperty.call(messages, value.kind) ? value.kind : 'unknown';
  const reference = typeof value.reference === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.reference)
    ? ` Reference: ${value.reference}.` : '';
  return messages[kind] + reference;
}
