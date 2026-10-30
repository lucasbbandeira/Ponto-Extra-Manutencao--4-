alter table public.overtime_entries add constraint overtime_required_information check (
 ((is_holiday) and normal_entry is null and point_exit is null and overtime_start is not null
  and note ~ '[^[:space:]]' and overtime_start < time '24:00' and final_exit < time '24:00')
 or
 ((not (is_holiday)) and point_exit is not null and (overtime_start is null or
  (normal_entry is not null and note ~ '[^[:space:]]' and overtime_start >= point_exit
   and normal_entry < time '24:00' and point_exit < time '24:00'
   and overtime_start < time '24:00' and final_exit < time '24:00')))
);
