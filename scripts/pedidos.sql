-- Query usada por `node scripts/top-afiliados.mjs --source sql`.
-- Ajuste tabelas/colunas ao schema real do banco. :'from' e :'to' são as datas
-- (YYYY-MM-DD) passadas pelo script. Os nomes das colunas de saída seguem os
-- aliases de server/normalize.mjs (id, created_at, product_name, niche,
-- affiliate_name, is_house_traffic, quantity, status, total, upsell_1_amount…).
select
  o.id,
  o.created_at,
  o.product_name,
  o.niche,
  o.affiliate_name,
  o.is_house_traffic,
  o.quantity,
  o.status,
  o.total
from orders o
where o.created_at >= :'from'::date
  and o.created_at < :'to'::date + interval '1 day'
