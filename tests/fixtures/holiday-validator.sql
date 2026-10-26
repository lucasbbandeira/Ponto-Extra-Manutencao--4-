CREATE OR REPLACE FUNCTION private.validate_overtime_input_v3(p_work_date date, p_normal_entry time without time zone, p_point_exit time without time zone, p_overtime_start time without time zone, p_final_exit time without time zone, p_final_exit_next_day boolean, p_note text, p_is_holiday boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare total numeric;
begin
  if p_work_date is null or p_overtime_start is null or p_final_exit is null
    or p_final_exit_next_day is null or p_is_holiday is null then
    raise exception 'Preencha a data, o inicio e o termino da hora extra';
  end if;
  if not p_is_holiday and (p_normal_entry is null or p_point_exit is null) then
    raise exception 'Em dia normal, preencha a entrada e a saida normal';
  end if;
  if p_note is null or p_note !~ '[^[:space:]]' or length(trim(p_note)) > 1000 then
    raise exception 'Preencha a descricao do servico (ate 1000 caracteres)';
  end if;
  if p_overtime_start >= time '24:00' or p_final_exit >= time '24:00'
    or extract(second from p_overtime_start) <> 0 or extract(second from p_final_exit) <> 0 then
    raise exception 'Informe horarios validos com horas e minutos';
  end if;
  if not p_is_holiday then
    if p_normal_entry >= time '24:00' or p_point_exit >= time '24:00'
      or extract(second from p_normal_entry) <> 0 or extract(second from p_point_exit) <> 0 then
      raise exception 'Informe horarios validos com horas e minutos';
    end if;
    if p_overtime_start < p_point_exit then
      raise exception 'O inicio da hora extra deve ser igual ou posterior a saida normal';
    end if;
  end if;
  total := extract(epoch from (
    (p_work_date + p_final_exit + case when p_final_exit_next_day then interval '1 day' else interval '0 day' end)
    - (p_work_date + p_overtime_start)
  )) / 60;
  if total < 1 or total > 960 then
    raise exception 'Confira os horarios: a hora extra deve durar de 1 minuto a 16 horas';
  end if;
end $function$

