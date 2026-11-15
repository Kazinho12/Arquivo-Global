-- F5.1 additive aggregates and diagnostics. No counters/receipts/history are rewritten.
BEGIN;
DO $$ BEGIN IF to_regprocedure('public.read_social_state(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'F5.1 required'; END IF;END $$;
CREATE INDEX social_library_favorites_count ON public.social_library(publication_id) WHERE favorite;
CREATE OR REPLACE FUNCTION public.read_social_state(p_work uuid,p_entry uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); result jsonb; BEGIN
 PERFORM public.social_assert_target(p_work,p_entry);
 SELECT pg_catalog.jsonb_build_object(
 'favorites',(SELECT count(*) FROM public.social_library WHERE publication_id=p_work AND favorite),
 'likes',(SELECT count(*) FROM public.social_likes WHERE publication_id=p_work AND target_id=COALESCE(p_entry,p_work)),
 'comments',(SELECT count(*) FROM public.social_comments WHERE publication_id=p_work AND COALESCE(entry_id,publication_id)=COALESCE(p_entry,p_work) AND status='visible'),
 'followers',(SELECT count(*) FROM public.social_work_follows WHERE publication_id=p_work),
 'liked',EXISTS(SELECT 1 FROM public.social_likes WHERE publication_id=p_work AND target_id=COALESCE(p_entry,p_work) AND user_id=actor),
 'following',EXISTS(SELECT 1 FROM public.social_work_follows WHERE publication_id=p_work AND user_id=actor),
 'saved',COALESCE((SELECT saved FROM public.social_library WHERE publication_id=p_work AND user_id=actor),false),
 'favorite',COALESCE((SELECT favorite FROM public.social_library WHERE publication_id=p_work AND user_id=actor),false),
 'later',COALESCE((SELECT later FROM public.social_library WHERE publication_id=p_work AND user_id=actor),false),
 'views',COALESCE((SELECT views FROM public.social_statistics WHERE publication_id=p_work AND target_id=COALESCE(p_entry,p_work)),0),
 'visitors',COALESCE((SELECT visitors FROM public.social_statistics WHERE publication_id=p_work AND target_id=COALESCE(p_entry,p_work)),0),
 'can_moderate',EXISTS(SELECT 1 FROM public.social_moderators WHERE user_id=actor)) INTO result;
 RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.read_social_state(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_social_state(uuid,uuid) TO anon,authenticated;

CREATE FUNCTION public.social_metrics_status(p_proof text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE expected text;BEGIN
 SELECT token_hash INTO expected FROM public.social_metric_settings WHERE id=true;
 IF p_proof IS NULL OR length(p_proof)<32 OR expected IS NULL OR expected IS DISTINCT FROM
 pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_proof,'UTF8')),'hex') THEN
 RAISE EXCEPTION 'Server proof required' USING ERRCODE='42501'; END IF;
 IF NOT pg_catalog.has_function_privilege('anon','public.record_social_view(uuid,uuid,text,text,text)','EXECUTE') THEN
 RAISE EXCEPTION 'Metrics execution denied' USING ERRCODE='42501'; END IF;
 RETURN '{"ready":true}'::jsonb;
END $$;
REVOKE EXECUTE ON FUNCTION public.social_metrics_status(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_metrics_status(text) TO anon;

CREATE FUNCTION public.read_social_rankings(p_mode text DEFAULT 'featured',p_format text DEFAULT '',p_sensitive boolean DEFAULT false,p_page integer DEFAULT 1,p_size integer DEFAULT 12)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE mode text:=COALESCE(p_mode,'featured'); page integer:=GREATEST(1,LEAST(COALESCE(p_page,1),10000));size integer:=GREATEST(1,LEAST(COALESCE(p_size,12),24));BEGIN
 IF mode NOT IN ('featured','views','likes','favorites','comments') OR COALESCE(p_format,'') NOT IN ('','Romance','Conto','Poesia','HQ / Comic','Mangá') THEN RAISE EXCEPTION 'Invalid ranking filter' USING ERRCODE='22023'; END IF;
 RETURN (
 WITH eligible AS MATERIALIZED (
 SELECT p.* FROM public.published_works p JOIN public.works w ON w.id=p.work_id
 WHERE p.is_public AND w.status='published' AND w.visibility='public' AND w.archived_at IS NULL
 AND (COALESCE(p_format,'')='' OR p.type=p_format)
 AND p.age_rating IN ('Livre','+12','+14','+16','+18')
 AND (COALESCE(p_sensitive,false) OR (p.age_rating<>'+18' AND cardinality(p.content_warnings)=0))
 ), likes AS (SELECT l.publication_id,count(*) n FROM public.social_likes l JOIN eligible p ON p.id=l.publication_id WHERE l.entry_id IS NULL GROUP BY l.publication_id),
 favorites AS (SELECT l.publication_id,count(*) n FROM public.social_library l JOIN eligible p ON p.id=l.publication_id WHERE l.favorite GROUP BY l.publication_id),
 comments AS (SELECT c.publication_id,count(*) n FROM public.social_comments c JOIN eligible p ON p.id=c.publication_id
 WHERE c.status='visible' AND (c.entry_id IS NULL OR EXISTS(SELECT 1 FROM public.published_work_entries e WHERE e.id=c.entry_id AND e.publication_id=c.publication_id)) GROUP BY c.publication_id),
 follows AS (SELECT f.publication_id,count(*) n FROM public.social_work_follows f JOIN eligible p ON p.id=f.publication_id GROUP BY f.publication_id),
 counts AS (
 SELECT p.id,p.slug,p.title,p.subtitle,p.description,p.type,p.genre,p.language,p.age_rating,p.tags,p.content_warnings,
 p.cover_accent_color,p.cover_style,p.cover_seed,p.cover_image,p.visual_settings,p.author_name,p.author_username,p.first_published_at,p.last_published_at,
 COALESCE(s.views,0) social_views,COALESCE(l.n,0) social_likes,COALESCE(f.n,0) social_favorites,COALESCE(c.n,0) social_comments,COALESCE(fw.n,0) social_followers
 FROM eligible p LEFT JOIN likes l ON l.publication_id=p.id LEFT JOIN favorites f ON f.publication_id=p.id
 LEFT JOIN comments c ON c.publication_id=p.id LEFT JOIN follows fw ON fw.publication_id=p.id
 LEFT JOIN public.social_statistics s ON s.publication_id=p.id AND s.entry_id IS NULL
 ), scored AS (
 SELECT counts.*,round(ln(1+social_views::numeric)+3*ln(1+social_likes::numeric)+4*ln(1+social_favorites::numeric)+2*ln(1+social_followers::numeric)+ln(1+social_comments::numeric),4) social_score FROM counts
 ), ranked AS (
 SELECT scored.*,CASE mode WHEN 'views' THEN social_views WHEN 'likes' THEN social_likes WHEN 'favorites' THEN social_favorites WHEN 'comments' THEN social_comments ELSE social_score END ranking_value FROM scored
 ), visible AS (SELECT * FROM ranked WHERE ranking_value>0), batch AS (
 SELECT * FROM visible ORDER BY ranking_value DESC,first_published_at DESC,id LIMIT size OFFSET (page-1)*size
 ) SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(to_jsonb(batch)-'ranking_value' ORDER BY ranking_value DESC,first_published_at DESC,id) FROM batch),'[]'::jsonb),
 'total',(SELECT count(*) FROM visible),'page',page,'size',size,'period','accumulated','mode',mode)
 );
END $$;
REVOKE EXECUTE ON FUNCTION public.read_social_rankings(text,text,boolean,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_social_rankings(text,text,boolean,integer,integer) TO anon,authenticated;
COMMIT;
