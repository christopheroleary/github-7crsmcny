-- Lets the client actually e-sign a contract themselves via the public
-- share link (typed name + server-side timestamp) rather than admin
-- manually transcribing "signed outside the app" into a free-text field,
-- which is all GigContract.jsx's ContractEditor ever did before this.
-- SECURITY DEFINER + token-scoped, same pattern as get_contract_by_token.
-- One-time only: rejects if this contract already has a client signature,
-- so the link can't be replayed to overwrite an existing signature.
create or replace function public.sign_contract_by_token(p_token uuid, p_signee_name text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_contract contracts%rowtype;
  v_name text;
begin
  v_name := trim(p_signee_name);
  if v_name = '' or v_name is null then
    raise exception 'Please enter a name to sign.';
  end if;
  if length(v_name) > 200 then
    raise exception 'That name is too long.';
  end if;

  select * into v_contract from public.contracts where share_token = p_token;
  if not found then
    raise exception 'Contract not found.';
  end if;
  if v_contract.client_signed_date is not null then
    raise exception 'This contract has already been signed.';
  end if;

  update public.contracts
  set client_signee_name = v_name,
      client_signed_date = current_date,
      status = case when band_signed_date is not null then 'signed' else status end
  where id = v_contract.id;

  return json_build_object('signee_name', v_name, 'signed_date', current_date);
end;
$function$;

grant execute on function public.sign_contract_by_token(uuid, text) to anon, authenticated;
