do $$ begin if to_regprocedure('cron.schedule(text,text,text)') is not null then perform cron.schedule('qf-md-prioridade','* * * * *','select private.qf_md_tick()'); end if; end $$;
