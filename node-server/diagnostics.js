// Only fixed, reviewed tokens may leave the provider error object. Never use
// its message, event ID, request headers, response body, or arbitrary strings.
const codes = new Map([
  ['invalid_api_key', 'authentication'], ['authentication_error', 'authentication'],
  ['insufficient_quota', 'quota'], ['billing_hard_limit_reached', 'quota'],
  ['rate_limit_exceeded', 'rate_limit'], ['rate_limit_error', 'rate_limit'],
  ['model_not_found', 'model_access'], ['permission_denied', 'model_access'],
  ['invalid_request_error', 'configuration'], ['invalid_event', 'configuration'],
  ['unknown_parameter', 'configuration'], ['missing_required_parameter', 'configuration'],
  ['invalid_value', 'configuration'], ['invalid_type', 'configuration'],
  ['input_audio_buffer_commit_empty', 'configuration'],
  ['conversation_already_has_active_response', 'configuration'],
  ['response_cancel_not_active', 'configuration'],
  ['server_error', 'provider'], ['internal_server_error', 'provider'],
]);
const fields = new Set([
  'session', 'session.type', 'session.model', 'session.instructions',
  'session.output_modalities', 'session.audio', 'session.audio.input',
  'session.audio.input.format', 'session.audio.input.format.type',
  'session.audio.input.format.rate', 'session.audio.input.turn_detection',
  'session.audio.input.turn_detection.type',
  'session.audio.input.turn_detection.create_response',
  'session.audio.input.turn_detection.interrupt_response',
  'session.audio.input.turn_detection.silence_duration_ms',
  'session.audio.output', 'session.audio.output.format',
  'session.audio.output.format.type', 'session.audio.output.format.rate',
  'session.audio.output.voice', 'audio', 'type', 'response',
  'item_id', 'audio_end_ms', 'content_index',
]);

export function providerDiagnostic(error, stage, reference) {
  const code = codes.has(error?.code) ? error.code : 'unknown_error';
  const errorType = codes.has(error?.type) ? error.type : 'unknown_error';
  return { source: 'openai', kind: codes.get(code) || codes.get(errorType) || 'unknown',
    code, errorType, parameter: fields.has(error?.param) ? error.param : null,
    stage, reference };
}

export function handshakeDiagnostic(status, reference) {
  const httpStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : null;
  const kind = httpStatus === 401 ? 'authentication'
    : httpStatus === 403 || httpStatus === 404 ? 'model_access'
    : httpStatus === 429 ? 'rate_or_quota'
    : httpStatus >= 500 ? 'provider' : 'connection';
  return { source: 'openai', kind, code: 'upstream_http_error', httpStatus,
    stage: 'connecting', reference };
}
