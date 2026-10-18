// Instrumentação opcional: chamar somente após autenticação do profissional.
// Um user-agent sozinho NÃO confirma instalação da Play Store.
export function detectarTipoAcesso() {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || navigator.standalone === true;
  return { tipo_acesso: standalone ? 'pwa' : 'navegador', confianca: 'inferida' };
}
export async function registrarAcessoProfissional(supabase, profissionalId, tipoConfirmado) {
  if (!supabase || !profissionalId) return { error: 'Sessão ausente' };
  const base = tipoConfirmado === 'play_store'
    ? { tipo_acesso: 'play_store', confianca: 'confirmada' }
    : detectarTipoAcesso();
  const permission = typeof Notification === 'undefined' ? null : Notification.permission;
  return supabase.from('qf_profissional_acessos').insert({
    profissional_id: profissionalId,
    ...base,
    push_permitido: permission === null ? null : permission === 'granted',
    push_inscrito: null
  });
}
