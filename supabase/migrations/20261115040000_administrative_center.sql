-- F5.2 consolidated local migration. No administrators, campaigns or legal approvals are seeded.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.social_moderators') IS NULL OR to_regclass('public.social_reports') IS NULL OR to_regclass('auth.sessions') IS NULL OR to_regprocedure('auth.jwt()') IS NULL THEN RAISE EXCEPTION 'F5.1 and Supabase sessions required'; END IF;
 IF NOT has_table_privilege(current_user,'auth.sessions','SELECT') OR NOT has_table_privilege(current_user,'auth.users','SELECT') THEN RAISE EXCEPTION 'Installer requires read access to Auth users/sessions';END IF;
END $$;
CREATE TABLE public.center_administrators(slot smallint PRIMARY KEY CHECK(slot IN (1,2)),user_id uuid UNIQUE NOT NULL REFERENCES auth.users ON DELETE CASCADE,active boolean NOT NULL DEFAULT true);
CREATE TABLE public.center_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid REFERENCES auth.users ON DELETE SET NULL,action text NOT NULL,target_id uuid,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX center_audit_actor ON public.center_audit(actor_id,created_at DESC);
CREATE INDEX center_audit_time ON public.center_audit(created_at DESC,id DESC);
CREATE TABLE public.center_operations(user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,operation_id uuid NOT NULL,fingerprint text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,operation_id));
CREATE INDEX center_operations_rate ON public.center_operations(user_id,created_at DESC);
CREATE TABLE public.center_reports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,target_kind text NOT NULL CHECK(target_kind IN ('work','profile')),target_id uuid NOT NULL,category text NOT NULL CHECK(category IN ('spam','abuse','copyright','privacy','other')),description text NOT NULL CHECK(char_length(description) BETWEEN 10 AND 4000),status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','reviewing','actioned','dismissed')),revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,target_kind,target_id));
CREATE INDEX center_reports_queue ON public.center_reports(status,created_at,id);
CREATE INDEX center_reports_owner ON public.center_reports(user_id,created_at DESC,id DESC);
ALTER TABLE public.social_reports ADD COLUMN center_description text CHECK(center_description IS NULL OR char_length(center_description)<=4000);
ALTER TABLE public.social_reports ADD COLUMN center_revision integer NOT NULL DEFAULT 1;
ALTER TABLE public.social_reports ADD COLUMN center_updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.social_reports ADD COLUMN center_category text NOT NULL DEFAULT 'other' CHECK(center_category IN ('spam','abuse','copyright','privacy','other'));
ALTER TABLE public.social_reports ADD COLUMN center_review_status text NOT NULL DEFAULT 'new' CHECK(center_review_status IN ('new','reviewing','actioned','dismissed'));
CREATE TABLE public.center_decisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source text NOT NULL CHECK(source IN ('center','social')),report_id uuid NOT NULL,subject_id uuid REFERENCES auth.users ON DELETE SET NULL,actor_id uuid REFERENCES auth.users ON DELETE SET NULL,action text NOT NULL CHECK(action IN ('no_action','warn','hide_comment','restore_comment','restrict_work','restore_work')),reason text NOT NULL CHECK(char_length(reason) BETWEEN 10 AND 2000),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX center_decisions_case ON public.center_decisions(source,report_id,created_at DESC);
CREATE TABLE public.center_restrictions(publication_id uuid PRIMARY KEY REFERENCES public.published_works ON DELETE CASCADE,active boolean NOT NULL DEFAULT true,decision_id uuid REFERENCES public.center_decisions,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.center_tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,title text NOT NULL CHECK(char_length(title) BETWEEN 3 AND 160),category text NOT NULL CHECK(category IN ('technical','account','copyright','appeal','other')),case_source text CHECK(case_source IN ('center','social')),case_id uuid,status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewing','awaiting_user','resolved','closed')),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX center_tickets_owner ON public.center_tickets(user_id,updated_at DESC,id DESC);
CREATE INDEX center_tickets_queue ON public.center_tickets(status,updated_at DESC,id DESC);
CREATE TABLE public.center_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ticket_id uuid NOT NULL REFERENCES public.center_tickets ON DELETE CASCADE,user_id uuid REFERENCES auth.users ON DELETE SET NULL,administrative boolean NOT NULL DEFAULT false,body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 8000),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX center_messages_ticket ON public.center_messages(ticket_id,created_at,id);
CREATE INDEX center_messages_rate ON public.center_messages(user_id,created_at DESC);
CREATE TABLE public.center_preferences(user_id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,official boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX center_preferences_opted ON public.center_preferences(user_id,updated_at) WHERE official;
CREATE TABLE public.center_broadcasts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text NOT NULL CHECK(char_length(title) BETWEEN 3 AND 160),body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 8000),audience text NOT NULL CHECK(audience IN ('opted_in','selected')),recipients uuid[] NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),sent_at timestamptz,CHECK(cardinality(recipients)<=100));
CREATE TABLE public.center_notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,kind text NOT NULL CHECK(kind IN ('official','service')),event_key text NOT NULL,title text NOT NULL,body text NOT NULL,context jsonb NOT NULL DEFAULT '{}',read_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,event_key));
CREATE INDEX center_notifications_event ON public.center_notifications(event_key);
CREATE INDEX center_notifications_owner ON public.center_notifications(user_id,created_at DESC,id DESC);
CREATE TABLE public.center_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN ('campaign','notice','update','status','policy')),slug text NOT NULL CHECK(slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),title text NOT NULL CHECK(char_length(title) BETWEEN 3 AND 160),body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 12000),state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','withdrawn')),severity text NOT NULL DEFAULT 'information' CHECK(severity IN ('information','operational','degraded','outage','maintenance')),starts_at timestamptz NOT NULL DEFAULT now(),ends_at timestamptz,image_publication uuid,image_asset uuid,image_permission boolean NOT NULL DEFAULT false,legal_approved boolean NOT NULL DEFAULT false,approved_by uuid REFERENCES auth.users ON DELETE SET NULL,verified_at timestamptz,revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(kind,slug),CHECK(ends_at IS NULL OR ends_at>starts_at),CHECK((image_publication IS NULL)=(image_asset IS NULL)),CHECK(NOT(state='published' AND kind='policy') OR legal_approved));
CREATE INDEX center_items_feed ON public.center_items(kind,state,starts_at DESC,id DESC);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['center_administrators','center_audit','center_operations','center_reports','center_decisions','center_restrictions','center_tickets','center_messages','center_preferences','center_broadcasts','center_notifications','center_items'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);END LOOP;END $$;
CREATE POLICY center_tickets_own ON public.center_tickets FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY center_notifications_own ON public.center_notifications FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY center_preferences_own ON public.center_preferences FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE FUNCTION public.center_is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND (SELECT count(*)=2 FROM public.center_administrators)
 AND EXISTS(SELECT 1 FROM public.center_administrators a JOIN public.social_moderators m ON m.user_id=a.user_id WHERE a.user_id=auth.uid() AND a.active)
 AND EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id::text=auth.jwt()->>'session_id' AND s.user_id=auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION public.center_is_admin() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.read_admin_bootstrap() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT public.center_is_admin() THEN RAISE EXCEPTION 'Not found' USING ERRCODE='P0002';END IF;
 RETURN jsonb_build_object('id',auth.uid(),'authorized',true);
END $$;
REVOKE EXECUTE ON FUNCTION public.read_admin_bootstrap() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_admin_bootstrap() TO authenticated;
CREATE FUNCTION public.center_admin_registry_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 INSERT INTO public.center_audit(actor_id,action,target_id,details) VALUES(auth.uid(),'admin_registry',COALESCE(NEW.user_id,OLD.user_id),jsonb_build_object('operation',TG_OP,'slot',COALESCE(NEW.slot,OLD.slot)));
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER center_registry_audit AFTER INSERT OR UPDATE OR DELETE ON public.center_administrators FOR EACH ROW EXECUTE FUNCTION public.center_admin_registry_audit();
REVOKE EXECUTE ON FUNCTION public.center_admin_registry_audit() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.center_publication_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NEW.is_public AND EXISTS(SELECT 1 FROM public.center_restrictions WHERE publication_id=NEW.id AND active) THEN RAISE EXCEPTION 'Publication restricted by administration' USING ERRCODE='42501';END IF;RETURN NEW;
END $$;
CREATE TRIGGER center_publication_guard BEFORE INSERT OR UPDATE OF is_public ON public.published_works FOR EACH ROW EXECUTE FUNCTION public.center_publication_guard();
REVOKE EXECUTE ON FUNCTION public.center_publication_guard() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.center_notify(p_user uuid,p_kind text,p_key text,p_title text,p_body text,p_context jsonb DEFAULT '{}') RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user) THEN RETURN false;END IF;
 IF p_kind='official' AND NOT COALESCE((SELECT official FROM public.center_preferences WHERE user_id=p_user),false) THEN RETURN false;END IF;
 INSERT INTO public.center_notifications(user_id,kind,event_key,title,body,context) VALUES(p_user,p_kind,p_key,p_title,p_body,p_context) ON CONFLICT(user_id,event_key) DO NOTHING;RETURN FOUND;
END $$;
REVOKE EXECUTE ON FUNCTION public.center_notify(uuid,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.center_public(p_kind text,p_slug text DEFAULT NULL,p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 12) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF p_kind IS NULL OR p_kind NOT IN ('campaign','notice','update','status','policy') THEN RAISE EXCEPTION 'Invalid kind' USING ERRCODE='22023';END IF;
 RETURN COALESCE((SELECT jsonb_agg(row ORDER BY row.starts_at DESC,row.id DESC) FROM (
 SELECT c.id,c.kind,c.slug,c.title,c.body,c.severity,c.starts_at,c.ends_at,c.updated_at,c.verified_at,
 CASE WHEN c.image_permission AND EXISTS(SELECT 1 FROM public.published_works p WHERE p.id=c.image_publication AND p.is_public AND p.cover_image->>'assetId'=c.image_asset::text) THEN jsonb_build_object('publication',c.image_publication,'asset',c.image_asset) ELSE NULL END image
 FROM public.center_items c WHERE c.kind=p_kind AND c.state='published' AND c.starts_at<=now() AND (c.ends_at IS NULL OR c.ends_at>now())
 AND (c.kind<>'policy' OR c.legal_approved) AND (p_slug IS NULL OR c.slug=p_slug)
 AND (p_before IS NULL OR (c.starts_at,c.id)<(p_before,COALESCE(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
 ORDER BY c.starts_at DESC,c.id DESC LIMIT GREATEST(1,LEAST(COALESCE(p_limit,12),30))) row),'[]');
END $$;
REVOKE EXECUTE ON FUNCTION public.center_public(text,text,timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.center_public(text,text,timestamptz,uuid,integer) TO anon,authenticated;

CREATE FUNCTION public.center_member(p_action text,p_data jsonb DEFAULT '{}',p_operation uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
<<member>>
DECLARE actor uuid:=auth.uid();cid uuid;sid uuid;source text;fp text;previous public.center_operations%ROWTYPE;result jsonb;body text;target uuid;category text;BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501';END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR octet_length(p_data::text)>24000 THEN RAISE EXCEPTION 'Invalid input' USING ERRCODE='22023';END IF;
 IF p_action='ticket' THEN
 SELECT to_jsonb(t)-'user_id' INTO result FROM public.center_tickets t WHERE t.id=(p_data->>'id')::uuid AND t.user_id=actor;
 IF result IS NULL THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501';END IF;RETURN result;
 ELSIF p_action='tickets' THEN
 RETURN COALESCE((SELECT jsonb_agg(row ORDER BY row.updated_at DESC,row.id DESC) FROM (SELECT id,title,center_tickets.category,status,created_at,updated_at,case_source,case_id FROM public.center_tickets WHERE user_id=actor AND (p_data->>'before' IS NULL OR (updated_at,id)<((p_data->>'before')::timestamptz,COALESCE((p_data->>'before_id')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'))) ORDER BY updated_at DESC,id DESC LIMIT 20) row),'[]');
 ELSIF p_action='messages' THEN
 cid:=(p_data->>'id')::uuid;IF NOT EXISTS(SELECT 1 FROM public.center_tickets WHERE id=cid AND user_id=actor) THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501';END IF;
 RETURN COALESCE((SELECT jsonb_agg(row ORDER BY row.created_at,row.id) FROM (SELECT id,center_messages.body,administrative,created_at FROM public.center_messages WHERE ticket_id=cid AND (p_data->>'after' IS NULL OR (created_at,id)>((p_data->>'after')::timestamptz,COALESCE((p_data->>'after_id')::uuid,'00000000-0000-0000-0000-000000000000'))) ORDER BY created_at,id LIMIT 30) row),'[]');
 ELSIF p_action='notifications' THEN
 RETURN COALESCE((SELECT jsonb_agg(row ORDER BY row.created_at DESC,row.id DESC) FROM (SELECT id,kind,title,center_notifications.body,context,read_at,created_at FROM public.center_notifications WHERE user_id=actor AND (p_data->>'before' IS NULL OR (created_at,id)<((p_data->>'before')::timestamptz,COALESCE((p_data->>'before_id')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'))) ORDER BY created_at DESC,id DESC LIMIT 20) row),'[]');
 ELSIF p_action='preferences' THEN RETURN jsonb_build_object('official',COALESCE((SELECT official FROM public.center_preferences WHERE user_id=actor),false));
 ELSIF p_action='reports' THEN
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(row)-'user_id'-'subject_id'-'description' ORDER BY row.created_at DESC,row.id DESC) FROM(SELECT * FROM public.center_report_queue q WHERE q.user_id=actor AND (p_data->>'before' IS NULL OR (q.created_at,q.id)<((p_data->>'before')::timestamptz,COALESCE((p_data->>'before_id')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'))) ORDER BY q.created_at DESC,q.id DESC LIMIT 20) row),'[]');
 ELSIF p_action='decisions' THEN
 cid:=(p_data->>'id')::uuid;source:=p_data->>'source';
 IF source IS NULL OR source NOT IN ('center','social') THEN RAISE EXCEPTION 'Invalid source' USING ERRCODE='22023';END IF;
 IF NOT(EXISTS(SELECT 1 FROM public.center_reports WHERE member.source='center' AND id=cid AND user_id=actor) OR EXISTS(SELECT 1 FROM public.social_reports WHERE member.source='social' AND id=cid AND user_id=actor) OR EXISTS(SELECT 1 FROM public.center_decisions d WHERE d.source=member.source AND d.report_id=cid AND d.subject_id=actor)) THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501';END IF;
 RETURN COALESCE((SELECT jsonb_agg(row ORDER BY row.created_at DESC,row.id DESC) FROM(SELECT id,action,reason,created_at FROM public.center_decisions d WHERE d.source=member.source AND d.report_id=cid ORDER BY created_at DESC,id DESC LIMIT 30) row),'[]');
 END IF;
 IF p_operation IS NULL THEN RAISE EXCEPTION 'Operation required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('center:'||actor::text,0));
 fp:=encode(sha256(convert_to(jsonb_build_array('member',p_action,p_data)::text,'UTF8')),'hex');SELECT * INTO previous FROM public.center_operations WHERE user_id=actor AND operation_id=p_operation;
 IF FOUND THEN IF previous.fingerprint<>fp THEN RAISE EXCEPTION 'Operation reused' USING ERRCODE='22023';END IF;RETURN previous.result;END IF;
 IF (SELECT count(*) FROM public.center_operations WHERE user_id=actor AND created_at>now()-interval '1 minute')>=60 THEN RAISE EXCEPTION 'Rate limited' USING ERRCODE='54000';END IF;
 result:='{"ok":true}';
 IF p_action='create_ticket' THEN
 body:=btrim(p_data->>'body');category:=p_data->>'category';
 IF body IS NULL OR body !~ '[^[:space:]]' OR p_data->>'title' IS NULL OR p_data->>'title' !~ '[^[:space:]]' OR char_length(body) NOT BETWEEN 10 AND 8000 OR char_length(btrim(p_data->>'title')) NOT BETWEEN 3 AND 160 OR category IS NULL OR category NOT IN ('technical','account','copyright','appeal','other') THEN RAISE EXCEPTION 'Invalid ticket' USING ERRCODE='22023';END IF;
 IF (SELECT count(*) FROM public.center_tickets WHERE user_id=actor AND created_at>now()-interval '24 hours')>=5 THEN RAISE EXCEPTION 'Ticket rate limited' USING ERRCODE='54000';END IF;
 cid:=NULLIF(p_data->>'case_id','')::uuid;source:=NULLIF(p_data->>'case_source','');
 IF (cid IS NULL)<>(source IS NULL) OR (source IS NOT NULL AND source NOT IN ('center','social')) THEN RAISE EXCEPTION 'Invalid source' USING ERRCODE='22023';END IF;
 IF cid IS NOT NULL AND NOT(EXISTS(SELECT 1 FROM public.center_reports WHERE member.source='center' AND id=cid AND user_id=actor) OR EXISTS(SELECT 1 FROM public.social_reports WHERE member.source='social' AND id=cid AND user_id=actor) OR EXISTS(SELECT 1 FROM public.center_decisions d WHERE d.source=member.source AND d.report_id=cid AND d.subject_id=actor)) THEN RAISE EXCEPTION 'Invalid case' USING ERRCODE='42501';END IF;
 INSERT INTO public.center_tickets(user_id,title,category,case_source,case_id) VALUES(actor,btrim(p_data->>'title'),category,source,cid) RETURNING id INTO cid;
 INSERT INTO public.center_messages(ticket_id,user_id,body) VALUES(cid,actor,body);result:=jsonb_build_object('ok',true,'id',cid);
 ELSIF p_action='reply_ticket' THEN
 cid:=(p_data->>'id')::uuid;body:=btrim(p_data->>'body');
 PERFORM 1 FROM public.center_tickets WHERE id=cid AND user_id=actor AND status<>'closed' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501';END IF;
 IF body IS NULL OR char_length(body) NOT BETWEEN 1 AND 8000 OR body !~ '[^[:space:]]' THEN RAISE EXCEPTION 'Invalid message' USING ERRCODE='22023';END IF;
 IF (SELECT count(*) FROM public.center_messages WHERE user_id=actor AND created_at>now()-interval '1 hour')>=20 THEN RAISE EXCEPTION 'Reply rate limited' USING ERRCODE='54000';END IF;
 INSERT INTO public.center_messages(ticket_id,user_id,body) VALUES(cid,actor,body);UPDATE public.center_tickets SET status='open',updated_at=now() WHERE id=cid;
 ELSIF p_action='report' THEN
 category:=p_data->>'category';body:=btrim(p_data->>'description');target:=(p_data->>'target_id')::uuid;
 IF category IS NULL OR category NOT IN ('spam','abuse','copyright','privacy','other') OR body IS NULL OR char_length(body) NOT BETWEEN 10 AND 4000 OR body !~ '[^[:space:]]' OR target IS NULL THEN RAISE EXCEPTION 'Invalid report' USING ERRCODE='22023';END IF;
 IF p_data->>'kind'='comment' THEN
 SELECT c.publication_id,c.entry_id INTO cid,sid FROM public.social_comments c WHERE c.id=target AND c.status='visible';
 IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501';END IF;
 PERFORM public.mutate_social(cid,sid,'report',jsonb_build_object('comment_id',target,'reason',left(category||': '||body,500)),p_operation);
 SELECT id INTO cid FROM public.social_reports WHERE user_id=actor AND comment_id=target;
 UPDATE public.social_reports SET center_category=category,center_description=COALESCE(center_description,body) WHERE id=cid AND center_review_status='new' AND status='open';source:='social';
 ELSE
 IF p_data->>'kind' NOT IN ('work','profile') OR p_data->>'kind' IS NULL THEN RAISE EXCEPTION 'Invalid target' USING ERRCODE='22023';END IF;
 IF p_data->>'kind'='work' THEN PERFORM public.social_assert_target(target,NULL);ELSE IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=target) THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501';END IF;END IF;
 SELECT id INTO cid FROM public.center_reports WHERE user_id=actor AND target_kind=p_data->>'kind' AND target_id=target;
 IF cid IS NULL THEN
 IF (SELECT count(*) FROM public.center_reports WHERE user_id=actor AND created_at>now()-interval '1 hour')>=10 THEN RAISE EXCEPTION 'Report rate limited' USING ERRCODE='54000';END IF;
 INSERT INTO public.center_reports(user_id,target_kind,target_id,category,description) VALUES(actor,p_data->>'kind',target,category,body) RETURNING id INTO cid;END IF;source:='center';
 END IF;result:=jsonb_build_object('ok',true,'id',cid,'source',source);
 ELSIF p_action='read_notification' THEN UPDATE public.center_notifications SET read_at=COALESCE(read_at,now()) WHERE id=(p_data->>'id')::uuid AND user_id=actor;IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501';END IF;
 ELSIF p_action='set_preferences' THEN
 IF jsonb_typeof(p_data->'official') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid preference' USING ERRCODE='22023';END IF;
 INSERT INTO public.center_preferences(user_id,official) VALUES(actor,(p_data->>'official')::boolean) ON CONFLICT(user_id) DO UPDATE SET official=EXCLUDED.official,updated_at=now();
 ELSE RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';END IF;
 INSERT INTO public.center_operations(user_id,operation_id,fingerprint,result) VALUES(actor,p_operation,fp,result);RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.center_member(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.center_member(text,jsonb,uuid) TO authenticated;
CREATE TABLE public.center_item_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),item_id uuid NOT NULL REFERENCES public.center_items,revision integer NOT NULL,snapshot jsonb NOT NULL,actor_id uuid REFERENCES auth.users ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(item_id,revision));
ALTER TABLE public.center_item_versions ENABLE ROW LEVEL SECURITY;REVOKE ALL ON public.center_item_versions FROM PUBLIC,anon,authenticated;
CREATE VIEW public.center_report_queue AS
 SELECT r.id,'center'::text source,r.user_id,r.target_kind,r.target_id,r.category,r.description,r.status,r.created_at,r.updated_at,r.revision,
 CASE WHEN r.target_kind='profile' THEN r.target_id ELSE w.owner_id END subject_id,
 CASE WHEN r.target_kind='work' THEN r.target_id ELSE NULL::uuid END publication_id,NULL::uuid entry_id
 FROM public.center_reports r LEFT JOIN public.published_works p ON p.id=r.target_id AND r.target_kind='work' LEFT JOIN public.works w ON w.id=p.work_id
 UNION ALL SELECT r.id,'social',r.user_id,'comment',r.comment_id,r.center_category,COALESCE(r.center_description,r.reason),
 CASE WHEN r.status='open' THEN r.center_review_status WHEN r.status='dismissed' THEN 'dismissed' ELSE 'actioned' END,r.created_at,r.center_updated_at,r.center_revision,c.user_id,c.publication_id,c.entry_id
 FROM public.social_reports r JOIN public.social_comments c ON c.id=r.comment_id;
REVOKE ALL ON public.center_report_queue FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.admin_console(p_action text,p_data jsonb DEFAULT '{}',p_operation uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
<<admin_vars>>
DECLARE actor uuid:=auth.uid();cid uuid;mid uuid;result jsonb:='{"ok":true}';fp text;previous public.center_operations%ROWTYPE;
 report public.center_report_queue%ROWTYPE;item public.center_items%ROWTYPE;broadcast public.center_broadcasts%ROWTYPE;recipient uuid;delivered integer:=0;decision uuid;desired text;body text;revision integer;BEGIN
 IF NOT public.center_is_admin() THEN RAISE EXCEPTION 'Not found' USING ERRCODE='P0002';END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR octet_length(p_data::text)>24000 THEN RAISE EXCEPTION 'Invalid input' USING ERRCODE='22023';END IF;
 IF p_action='bootstrap' THEN RETURN public.read_admin_bootstrap();
 ELSIF p_action='dashboard' THEN
 RETURN jsonb_build_object('users',(SELECT count(*) FROM auth.users),'registrations_7d',(SELECT count(*) FROM auth.users WHERE created_at>now()-interval '7 days'),'registrations_30d',(SELECT count(*) FROM auth.users WHERE created_at>now()-interval '30 days'),
 'works',(SELECT count(*) FROM public.works),'publications',(SELECT count(*) FROM public.published_works p JOIN public.works w ON w.id=p.work_id WHERE p.is_public AND w.status='published' AND w.archived_at IS NULL),
 'consented_views',COALESCE((SELECT sum(views) FROM public.social_statistics WHERE entry_id IS NULL),0),'chapter_reads',COALESCE((SELECT sum(views) FROM public.social_statistics WHERE entry_id IS NOT NULL),0),
 'likes',(SELECT count(*) FROM public.social_likes),'favorites',(SELECT count(*) FROM public.social_library WHERE favorite),'comments',(SELECT count(*) FROM public.social_comments WHERE status='visible'),
 'author_follows',(SELECT count(*) FROM public.profile_follows),'work_follows',(SELECT count(*) FROM public.social_work_follows),
 'open_reports',(SELECT count(*) FROM public.center_report_queue WHERE status IN ('new','reviewing')),'open_tickets',(SELECT count(*) FROM public.center_tickets WHERE status NOT IN ('resolved','closed')),'as_of',now());
 ELSIF p_action='reports' THEN
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(row)-'user_id'-'subject_id' ORDER BY row.created_at DESC,row.id DESC) FROM(SELECT * FROM public.center_report_queue WHERE (COALESCE(p_data->>'status','')='' OR status=p_data->>'status') AND (p_data->>'before' IS NULL OR (created_at,id)<((p_data->>'before')::timestamptz,COALESCE((p_data->>'before_id')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'))) ORDER BY created_at DESC,id DESC LIMIT 20) row),'[]');
 ELSIF p_action='tickets' THEN RETURN COALESCE((SELECT jsonb_agg(to_jsonb(row)-'user_id' ORDER BY row.updated_at DESC,row.id DESC) FROM(SELECT * FROM public.center_tickets WHERE (COALESCE(p_data->>'status','')='' OR status=p_data->>'status') AND (p_data->>'before' IS NULL OR (updated_at,id)<((p_data->>'before')::timestamptz,COALESCE((p_data->>'before_id')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'))) ORDER BY updated_at DESC,id DESC LIMIT 20) row),'[]');
 ELSIF p_action='messages' THEN
 cid:=(p_data->>'id')::uuid;IF NOT EXISTS(SELECT 1 FROM public.center_tickets WHERE id=cid) THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='22023';END IF;
 RETURN COALESCE((SELECT jsonb_agg(row ORDER BY row.created_at,row.id) FROM(SELECT id,center_messages.body,administrative,created_at FROM public.center_messages WHERE ticket_id=cid AND (p_data->>'after' IS NULL OR (created_at,id)>((p_data->>'after')::timestamptz,COALESCE((p_data->>'after_id')::uuid,'00000000-0000-0000-0000-000000000000'))) ORDER BY created_at,id LIMIT 30) row),'[]');
 ELSIF p_action='items' THEN RETURN COALESCE((SELECT jsonb_agg(to_jsonb(row)-'approved_by' ORDER BY row.updated_at DESC,row.id DESC) FROM(SELECT * FROM public.center_items WHERE (COALESCE(p_data->>'kind','')='' OR kind=p_data->>'kind') AND (p_data->>'before' IS NULL OR (updated_at,id)<((p_data->>'before')::timestamptz,COALESCE((p_data->>'before_id')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'))) ORDER BY updated_at DESC,id DESC LIMIT 20) row),'[]');
 ELSIF p_action='versions' THEN RETURN COALESCE((SELECT jsonb_agg(row ORDER BY row.revision DESC) FROM(SELECT revision,snapshot,created_at FROM public.center_item_versions WHERE item_id=(p_data->>'id')::uuid ORDER BY revision DESC LIMIT 30) row),'[]');
 ELSIF p_action='broadcasts' THEN RETURN COALESCE((SELECT jsonb_agg(row ORDER BY row.created_at DESC,row.id DESC) FROM(SELECT b.id,b.title,b.body,b.audience,cardinality(b.recipients) selected_count,b.created_at,b.sent_at,(SELECT count(*) FROM public.center_notifications n WHERE n.event_key='broadcast:'||b.id::text) delivered FROM public.center_broadcasts b WHERE p_data->>'before' IS NULL OR (b.created_at,b.id)<((p_data->>'before')::timestamptz,COALESCE((p_data->>'before_id')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff')) ORDER BY b.created_at DESC,b.id DESC LIMIT 20) row),'[]');
 ELSIF p_action='audit' THEN RETURN COALESCE((SELECT jsonb_agg(row ORDER BY row.created_at DESC,row.id DESC) FROM(SELECT a.id,a.action,a.target_id,a.details,a.created_at,pr.username actor FROM public.center_audit a LEFT JOIN public.profiles pr ON pr.id=a.actor_id WHERE p_data->>'before' IS NULL OR (a.created_at,a.id)<((p_data->>'before')::timestamptz,COALESCE((p_data->>'before_id')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff')) ORDER BY a.created_at DESC,a.id DESC LIMIT 25) row),'[]');
 END IF;
 IF p_operation IS NULL THEN RAISE EXCEPTION 'Operation required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('center-admin:'||actor::text,0));fp:=encode(sha256(convert_to(jsonb_build_array('admin',p_action,p_data)::text,'UTF8')),'hex');
 SELECT * INTO previous FROM public.center_operations WHERE user_id=actor AND operation_id=p_operation;
 IF FOUND THEN IF previous.fingerprint<>fp THEN RAISE EXCEPTION 'Operation reused' USING ERRCODE='22023';END IF;RETURN previous.result;END IF;
 IF (SELECT count(*) FROM public.center_operations WHERE user_id=actor AND created_at>now()-interval '1 minute')>=120 THEN RAISE EXCEPTION 'Rate limited' USING ERRCODE='54000';END IF;
 cid:=NULLIF(p_data->>'id','')::uuid;
 IF p_action IN ('classify_report','decide_report') THEN
 -- Lock the source row before reading the unified queue; serialize decisions between both administrators.
 IF p_data->>'source'='center' THEN PERFORM 1 FROM public.center_reports WHERE id=cid FOR UPDATE;
 ELSIF p_data->>'source'='social' THEN PERFORM 1 FROM public.social_reports WHERE id=cid FOR UPDATE;
 ELSE RAISE EXCEPTION 'Invalid source' USING ERRCODE='22023';END IF;
 SELECT * INTO report FROM public.center_report_queue q WHERE q.id=cid AND q.source=p_data->>'source';IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='22023';END IF;
 IF report.revision IS DISTINCT FROM (p_data->>'revision')::integer OR report.status IS DISTINCT FROM p_data->>'expected_status' THEN RAISE EXCEPTION 'Revision conflict' USING ERRCODE='40001';END IF;
 IF p_action='classify_report' THEN
 IF p_data->>'category' IS NULL OR p_data->>'category' NOT IN ('spam','abuse','copyright','privacy','other') THEN RAISE EXCEPTION 'Invalid category' USING ERRCODE='22023';END IF;
 IF report.source='center' THEN UPDATE public.center_reports SET category=p_data->>'category',status='reviewing',revision=center_reports.revision+1,updated_at=now() WHERE id=cid;
 ELSE UPDATE public.social_reports SET center_category=p_data->>'category',status='open',center_review_status='reviewing',center_revision=center_revision+1,center_updated_at=now() WHERE id=cid;END IF;
 ELSE
 desired:=p_data->>'decision';body:=btrim(p_data->>'reason');
 IF desired IS NULL OR desired NOT IN ('no_action','warn','hide_comment','restore_comment','restrict_work','restore_work') OR body IS NULL OR char_length(body) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'Invalid decision' USING ERRCODE='22023';END IF;
 IF desired IN ('hide_comment','restore_comment') AND report.target_kind<>'comment' OR desired IN ('restrict_work','restore_work') AND report.target_kind<>'work' THEN RAISE EXCEPTION 'Wrong target' USING ERRCODE='22023';END IF;
 INSERT INTO public.center_decisions(source,report_id,subject_id,actor_id,action,reason) VALUES(report.source,cid,report.subject_id,actor,desired,body) RETURNING id INTO decision;
 IF desired='hide_comment' THEN UPDATE public.social_comments SET status='hidden' WHERE id=report.target_id AND status='visible';
 ELSIF desired='restore_comment' THEN UPDATE public.social_comments SET status='visible' WHERE id=report.target_id AND status='hidden';
 ELSIF desired='restrict_work' THEN
 INSERT INTO public.center_restrictions(publication_id,active,decision_id) VALUES(report.publication_id,true,decision) ON CONFLICT(publication_id) DO UPDATE SET active=true,decision_id=EXCLUDED.decision_id,updated_at=now();
 UPDATE public.published_works SET is_public=false WHERE id=report.publication_id;
 ELSIF desired='restore_work' THEN
 UPDATE public.center_restrictions SET active=false,decision_id=decision,updated_at=now() WHERE publication_id=report.publication_id;
 UPDATE public.published_works p SET is_public=true FROM public.works w WHERE p.id=report.publication_id AND w.id=p.work_id AND w.status='published' AND w.visibility='public' AND w.archived_at IS NULL;
 END IF;
 IF report.source='center' THEN UPDATE public.center_reports SET status=CASE WHEN desired='no_action' THEN 'dismissed' ELSE 'actioned' END,revision=center_reports.revision+1,updated_at=now() WHERE id=cid;
 ELSE UPDATE public.social_reports SET status=CASE WHEN desired='no_action' THEN 'dismissed' ELSE 'resolved' END,center_review_status=CASE WHEN desired='no_action' THEN 'dismissed' ELSE 'actioned' END,center_revision=center_revision+1,center_updated_at=now() WHERE id=cid;END IF;
 PERFORM public.center_notify(report.user_id,'service','decision:'||decision::text,'Decisão sobre denúncia',body,jsonb_build_object('case_id',cid,'source',report.source,'action',desired));
 PERFORM public.center_notify(report.subject_id,'service','decision:'||decision::text,'Revisão de conteúdo',body,jsonb_build_object('case_id',cid,'source',report.source,'action',desired));
 result:=jsonb_build_object('ok',true,'decision_id',decision);
 END IF;
 ELSIF p_action='reply_ticket' THEN
 body:=btrim(p_data->>'body');desired:=p_data->>'status';
 IF body IS NULL OR char_length(body) NOT BETWEEN 1 AND 8000 OR body !~ '[^[:space:]]' OR desired IS NULL OR desired NOT IN ('open','reviewing','awaiting_user','resolved','closed') THEN RAISE EXCEPTION 'Invalid reply' USING ERRCODE='22023';END IF;
 SELECT user_id INTO recipient FROM public.center_tickets WHERE id=cid FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='22023';END IF;
 INSERT INTO public.center_messages(ticket_id,user_id,administrative,body) VALUES(cid,actor,true,body) RETURNING id INTO mid;UPDATE public.center_tickets SET status=desired,updated_at=now() WHERE id=cid;
 PERFORM public.center_notify(recipient,'service','support:'||mid::text,'Resposta ao pedido de suporte',body,jsonb_build_object('ticket_id',cid));
 ELSIF p_action='save_item' THEN
 IF cid IS NOT NULL THEN SELECT * INTO item FROM public.center_items WHERE id=cid FOR UPDATE;IF NOT FOUND OR item.revision IS DISTINCT FROM (p_data->>'revision')::integer THEN RAISE EXCEPTION 'Revision conflict' USING ERRCODE='40001';END IF;END IF;
 IF p_data->>'kind' IS NULL OR p_data->>'kind' NOT IN ('campaign','notice','update','status','policy') OR p_data->>'state' IS NULL OR p_data->>'state' NOT IN ('draft','published','withdrawn') OR p_data->>'title' IS NULL OR p_data->>'body' IS NULL OR p_data->>'title' !~ '[^[:space:]]' OR p_data->>'body' !~ '[^[:space:]]' OR char_length(btrim(p_data->>'title')) NOT BETWEEN 3 AND 160 OR char_length(btrim(p_data->>'body')) NOT BETWEEN 1 AND 12000 THEN RAISE EXCEPTION 'Invalid content' USING ERRCODE='22023';END IF;
 IF cid IS NOT NULL AND item.kind<>p_data->>'kind' THEN RAISE EXCEPTION 'Kind immutable' USING ERRCODE='22023';END IF;
 IF p_data->>'state'='published' AND p_data->>'kind' IN ('notice','status','update') AND p_data->'verified' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Verification required' USING ERRCODE='22023';END IF;
 IF p_data->>'state'='published' AND p_data->>'kind'='policy' AND p_data->'legal_approved' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Legal approval required' USING ERRCODE='22023';END IF;
 IF NULLIF(p_data->>'image_publication','') IS NOT NULL THEN
 IF p_data->'image_permission' IS DISTINCT FROM 'true'::jsonb OR NOT EXISTS(SELECT 1 FROM public.published_works p WHERE p.id=(p_data->>'image_publication')::uuid AND p.is_public AND p.cover_image->>'assetId'=p_data->>'image_asset') THEN RAISE EXCEPTION 'Public cover and permission required' USING ERRCODE='42501';END IF;
 END IF;
 revision:=COALESCE(item.revision,0)+1;cid:=COALESCE(cid,gen_random_uuid());
 INSERT INTO public.center_items(id,kind,slug,title,body,state,severity,starts_at,ends_at,image_publication,image_asset,image_permission,legal_approved,approved_by,verified_at,revision)
 VALUES(cid,p_data->>'kind',p_data->>'slug',btrim(p_data->>'title'),btrim(p_data->>'body'),p_data->>'state',COALESCE(p_data->>'severity','information'),COALESCE(NULLIF(p_data->>'starts_at','')::timestamptz,now()),NULLIF(p_data->>'ends_at','')::timestamptz,NULLIF(p_data->>'image_publication','')::uuid,NULLIF(p_data->>'image_asset','')::uuid,COALESCE((p_data->>'image_permission')::boolean,false),COALESCE((p_data->>'legal_approved')::boolean,false),CASE WHEN p_data->'legal_approved'='true'::jsonb THEN actor END,CASE WHEN p_data->'verified'='true'::jsonb THEN now() END,revision)
 ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,title=EXCLUDED.title,body=EXCLUDED.body,state=EXCLUDED.state,severity=EXCLUDED.severity,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,image_publication=EXCLUDED.image_publication,image_asset=EXCLUDED.image_asset,image_permission=EXCLUDED.image_permission,legal_approved=EXCLUDED.legal_approved,approved_by=EXCLUDED.approved_by,verified_at=EXCLUDED.verified_at,revision=EXCLUDED.revision,updated_at=now();
 INSERT INTO public.center_item_versions(item_id,revision,snapshot,actor_id) SELECT id,center_items.revision,to_jsonb(center_items)-'approved_by',actor FROM public.center_items WHERE id=cid;
 result:=jsonb_build_object('ok',true,'id',cid,'revision',revision);
 ELSIF p_action='create_broadcast' THEN
 IF (SELECT count(*) FROM public.center_audit WHERE actor_id=actor AND action='create_broadcast' AND created_at>now()-interval '1 hour')>=10 THEN RAISE EXCEPTION 'Broadcast rate limited' USING ERRCODE='54000';END IF;
 IF p_data->>'title' IS NULL OR p_data->>'body' IS NULL OR p_data->>'title' !~ '[^[:space:]]' OR p_data->>'body' !~ '[^[:space:]]' OR char_length(btrim(p_data->>'title')) NOT BETWEEN 3 AND 160 OR char_length(btrim(p_data->>'body')) NOT BETWEEN 1 AND 8000 OR p_data->>'audience' IS NULL OR p_data->>'audience' NOT IN ('opted_in','selected') THEN RAISE EXCEPTION 'Invalid broadcast' USING ERRCODE='22023';END IF;
 IF p_data->>'audience'='selected' AND (jsonb_typeof(p_data->'recipients') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'recipients') NOT BETWEEN 1 AND 100) THEN RAISE EXCEPTION 'Invalid recipients' USING ERRCODE='22023';END IF;
 INSERT INTO public.center_broadcasts(title,body,audience,recipients) VALUES(btrim(p_data->>'title'),btrim(p_data->>'body'),p_data->>'audience',COALESCE(ARRAY(SELECT DISTINCT value::uuid FROM jsonb_array_elements_text(COALESCE(p_data->'recipients','[]'))),ARRAY[]::uuid[])) RETURNING id INTO cid;result:=jsonb_build_object('ok',true,'id',cid);
 ELSIF p_action='dispatch_broadcast' THEN
 SELECT * INTO broadcast FROM public.center_broadcasts WHERE id=cid FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='22023';END IF;
 IF broadcast.sent_at IS NOT NULL THEN result:=jsonb_build_object('ok',true,'done',true,'delivered',0);
 ELSE
 FOR recipient IN SELECT pref.user_id FROM public.center_preferences pref WHERE pref.official AND pref.updated_at<=broadcast.created_at AND (broadcast.audience='opted_in' OR pref.user_id=ANY(broadcast.recipients)) AND NOT EXISTS(SELECT 1 FROM public.center_notifications n WHERE n.user_id=pref.user_id AND n.event_key='broadcast:'||cid::text) ORDER BY pref.user_id LIMIT 100 LOOP
 IF public.center_notify(recipient,'official','broadcast:'||cid::text,broadcast.title,broadcast.body,jsonb_build_object('broadcast_id',cid)) THEN delivered:=delivered+1;END IF;END LOOP;
 IF NOT EXISTS(SELECT 1 FROM public.center_preferences pref WHERE pref.official AND pref.updated_at<=broadcast.created_at AND (broadcast.audience='opted_in' OR pref.user_id=ANY(broadcast.recipients)) AND NOT EXISTS(SELECT 1 FROM public.center_notifications n WHERE n.user_id=pref.user_id AND n.event_key='broadcast:'||cid::text)) THEN UPDATE public.center_broadcasts SET sent_at=now() WHERE id=cid;desired:='done';END IF;
 result:=jsonb_build_object('ok',true,'done',COALESCE(desired='done',false),'delivered',delivered);
 END IF;
 ELSE RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';END IF;
 INSERT INTO public.center_audit(actor_id,action,target_id,details) VALUES(actor,p_action,cid,jsonb_build_object('source',p_data->>'source','status',p_data->>'status','decision',p_data->>'decision','result',result));
 INSERT INTO public.center_operations(user_id,operation_id,fingerprint,result) VALUES(actor,p_operation,fp,result);RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_console(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_console(text,jsonb,uuid) TO authenticated;
COMMIT;
