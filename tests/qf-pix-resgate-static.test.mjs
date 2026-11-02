import {readFileSync} from "node:fs";
import {join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root=join(dirname(fileURLToPath(import.meta.url)),"..");
const sql=readFileSync(join(root,"supabase/patches/2026-11-02-qf-resgate-automatico-aprovado.sql"),"utf8");
const sync=readFileSync(join(root,"supabase/functions/quemfaz-efi-pix-sync/index.ts"),"utf8");

test("nao aprovar pix pendente ou historico R$ 13",()=>{
 assert.match(sql,/r.status<>'aprovado'/);
 assert.match(sql,/r.valor_centavos=1499/);
 assert.doesNotMatch(sql,/r.valor_centavos=1300/);
});
test("resgate somente service_role",()=>{
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.qf_auto_resgatar_pre_cadastro\(uuid\) TO service_role;/);
 assert.match(sql,/auth\.jwt\(\)->>'role'/);
});
test("resgate nao identifica por email isoladamente",()=>{
 assert.match(sql,/private\.qf_cadastro_pagamento_vinculo/);
 assert.match(sql,/u.email_confirmed_at IS NOT NULL/);
 assert.match(sql,/p.tipo='profissional'/);
});
test("idempotencia com lock e checagem de credito",()=>{
 assert.match(sql,/FOR UPDATE/);
 assert.match(sql,/ON CONFLICT DO NOTHING/);
 assert.match(sql,/IF n<>1 THEN/);
 assert.match(sql,/ja_resgatado/);
});
test("precadastro sem perfil fica aguardando",()=>{
 assert.match(sql,/aguardando_identificacao/);
});
test("backend chama resgate apos EFÍ e reconcilia aprovados",()=>{
 assert.match(sync,/if\(spec.tipo==="precadastro"\) await autoResgatar/);
 assert.match(sync,/backlog/);
 assert.match(sync,/await autoResgatar\(String\(item.id\)\)/);
});
test("segredo cron nao embutido e diagnostico seguro",()=>{
 assert.match(sync,/Deno.env.get\("QF_PIX_SYNC_INTERNAL_TOKEN"\)/);
 assert.doesNotMatch(sync,/const INTERNAL_TOKEN="[a-zA-Z0-9]{20,}"/);
 assert.match(sync,/QF_EFI_PIX_SYNC_FAILED/);
});
