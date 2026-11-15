import { ReadingListPicker } from "../library/AdvancedLibrary";
import {
  ReadingSession,
  ReadingWorkVisit,
  useReadingWork,
  ChapterReadingIndicator,
} from "../library/ReadingProvider";
import { points } from "../library/readingCache";
import { SocialPanel } from "../social/SocialPanel";
import { PublicVisualReader } from "../visual/PublicVisualReader";
import { publicVisualReaderEnabled } from "../visual/public";
import { usePublicationSeo } from "../seo/usePublicationSeo";
import { useLibrary } from "../library/store";
import { resumeChapter } from "../reader/progress";
import { Link, useParams } from "react-router-dom";
import { Badge, Button } from "../../components/ui";
import { Cover } from "../../components/WorkCard";
import { usePublishedWork, usePublicCatalog } from "./PublicCatalog";
import { ProseReader } from "../reader/ProseReader";
import { PoetryReader } from "../reader/PoetryReader";
import { NotFound } from "../../pages/States";
export function PublishedWorkPage() {
  const { id = "" } = useParams();
  const state = usePublishedWork(id);
  useReadingWork(state.work);
  usePublicationSeo(state.error ? null : state.work, state.loading);
  const { entries } = useLibrary();
  const catalog = usePublicCatalog();
  if (state.loading)
    return (
      <div className="container">
        <p role="status">A carregar publicação…</p>
      </div>
    );
  if (state.error)
    return (
      <div className="container">
        <p role="alert">{state.error}</p>
        <Button onClick={catalog.refresh}>Tentar novamente</Button>
      </div>
    );
  if (!state.work) return <NotFound />;
  const work = state.work;
  const previous = entries.find((entry) => entry.workId === work.id);
  const recent = points()
    .filter((p) => p.work === work.id)
    .sort((a, b) => b.time.localeCompare(a.time))[0];
  const resume = resumeChapter(
    work.chapters,
    recent?.entry ?? previous?.lastReadChapterId,
  );
  const visual = work.format === "HQ / Comic" || work.format === "Mangá";
  return (
    <div className="container discovery-page work-page">
      <ReadingWorkVisit work={work} />
      <nav>
        <Link to="/catalogo">← Catálogo público</Link>
      </nav>
      <article className="work-presentation">
        <aside className="work-cover-column">
          <Cover work={work} />
          <p>Composição tipográfica · sem capa enviada</p>
        </aside>
        <div className="work-information">
          <Badge>Publicada pelo autor</Badge>
          <Badge>{work.format}</Badge>
          <h1>{work.title}</h1>
          <p>
            {work.authorUsername ? (
              <Link to={`/utilizadores/${work.authorUsername}`}>
                {work.author}
              </Link>
            ) : (
              work.author
            )}
          </p>
          <section className="synopsis">
            <h2>Sinopse</h2>
            <p>{work.synopsis}</p>
          </section>
          <dl className="work-facts">
            <div>
              <dt>Género</dt>
              <dd>{work.genre || "Não indicado"}</dd>
            </div>
            <div>
              <dt>Idioma</dt>
              <dd>{work.language}</dd>
            </div>
            <div>
              <dt>Classificação etária</dt>
              <dd>{work.ageRating}</dd>
            </div>
            <div>
              <dt>Primeira publicação</dt>
              <dd>
                <time dateTime={work.firstPublishedAt}>
                  {new Date(work.firstPublishedAt).toLocaleString("pt-PT")}
                </time>
              </dd>
            </div>
            <div>
              <dt>Última publicação</dt>
              <dd>
                <time dateTime={work.lastPublishedAt}>
                  {new Date(work.lastPublishedAt).toLocaleString("pt-PT")}
                </time>
              </dd>
            </div>
          </dl>
          <div className="work-tags">
            {work.tags.map((tag) => (
              <Link key={tag} to={`/catalogo?tag=${encodeURIComponent(tag)}`}>
                {tag}
              </Link>
            ))}
          </div>
          {work.contentWarnings.length > 0 && (
            <p>Avisos de conteúdo: {work.contentWarnings.join(", ")}</p>
          )}
          {visual && !work.hasVisualPublication && (
            <p className="notice">
              Publicação do guião textual. Esta edição não contém páginas de
              imagens.
            </p>
          )}
          {resume && (
            <div className="reader-resume">
              <Link
                className="button primary"
                to={`/obras/${work.id}/capitulos/${resume.id}`}
              >
                {(recent?.entry ?? previous?.lastReadChapterId) === resume.id
                  ? "Retomar leitura"
                  : "Começar leitura"}
                : {resume.title}
              </Link>
              {(recent || previous) &&
                (recent?.entry ?? previous?.lastReadChapterId) !==
                  resume.id && (
                  <p>
                    O capítulo guardado já não está nesta edição. Podes começar
                    pela primeira entrada disponível.
                  </p>
                )}
              <p>
                A continuidade local é preservada. A sincronização privada entre
                dispositivos é opcional e pode ser gerida na biblioteca.
              </p>
            </div>
          )}
          <section className="editorial-chapters">
            <h2>
              {work.format === "Poesia"
                ? "Poemas publicados"
                : work.hasVisualPublication
                  ? work.visualSettings?.format === "webtoon"
                    ? "Episódios publicados"
                    : "Capítulos visuais publicados"
                  : visual
                    ? "Guião publicado"
                    : "Capítulos publicados"}
            </h2>
            <ol>
              {work.chapters.map((entry) => (
                <li key={entry.id}>
                  <Link to={`/obras/${work.id}/capitulos/${entry.id}`}>
                    {entry.number}. {entry.title}{" "}
                    <ChapterReadingIndicator work={work.id} entry={entry.id} />
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </article>
      <p>
        <Link to={`/denunciar?tipo=work&id=${work.id}`}>
          Denunciar esta obra
        </Link>
      </p>
      <ReadingListPicker work={work.id} />
      <SocialPanel workId={work.id} />
    </div>
  );
}
export function PublishedReaderPage() {
  const { id = "", capituloId } = useParams();
  const state = usePublishedWork(id, true);
  const catalog = usePublicCatalog();
  if (state.loading)
    return (
      <div className="container">
        <p role="status">A carregar conteúdo publicado…</p>
      </div>
    );
  if (state.error)
    return (
      <div className="container">
        <p role="alert">{state.error}</p>
        <Button onClick={catalog.refresh}>Tentar novamente</Button>
      </div>
    );
  const work = state.work;
  const chapter = work?.chapters.find((entry) => entry.id === capituloId);
  if (!work || !chapter) return <NotFound />;
  if (work.hasVisualPublication) {
    if (!publicVisualReaderEnabled || !work.visualSettings)
      return (
        <section className="container">
          <h1>Leitura visual indisponível neste ambiente</h1>
          <Link to={`/obras/${work.id}`}>Voltar à obra</Link>
        </section>
      );
    return (
      <>
        <ReadingSession work={work} chapter={chapter.id}>
          <PublicVisualReader
            key={`${id}:${capituloId}:${work.lastPublishedAt}`}
            work={work}
            chapter={chapter}
          />
        </ReadingSession>
        <SocialPanel workId={work.id} entryId={chapter.id} />
      </>
    );
  }
  const props = {
    workId: work.id,
    workTitle: work.title,
    author: work.author,
    chapters: work.chapters,
    currentChapter: chapter,
    trackProgress: true,
    showCommunityLinks: false,
  };
  if (work.format === "Poesia")
    return (
      <>
        <ReadingSession work={work} chapter={chapter.id}>
          <PoetryReader key={`${id}:${capituloId}`} {...props} />
        </ReadingSession>
        <SocialPanel workId={work.id} entryId={chapter.id} />
      </>
    );
  return (
    <>
      {["HQ / Comic", "Mangá"].includes(work.format) && (
        <p className="notice container">
          Leitura do guião textual · sem imagens nesta edição
        </p>
      )}
      <ReadingSession work={work} chapter={chapter.id}>
        <ProseReader key={`${id}:${capituloId}`} {...props} />
      </ReadingSession>
      <SocialPanel workId={work.id} entryId={chapter.id} />
    </>
  );
}
