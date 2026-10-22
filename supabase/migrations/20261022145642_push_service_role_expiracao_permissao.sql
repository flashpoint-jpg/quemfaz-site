-- O RPC de reserva usa SECURITY INVOKER e consulta a regra privada de expiração.
-- Somente o papel do backend recebe acesso ao namespace; clientes permanecem sem acesso.
grant usage on schema private to service_role;
