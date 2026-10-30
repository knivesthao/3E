import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  aiArt,
  aiFinish,
  aiPortrait,
  aiSimplify,
  createScene,
  deleteScene,
  getProject,
  parseScene,
  publishProject,
  reorderScenes,
  updateProject,
  updateScene,
} from '../lib/api';
import { LEVELS } from '../lib/api';
import type { Book, Cast, CastKind, Panel, Project, Scene, SceneData } from '../lib/api';
import { Alert, Badge, Button, Field, Page, inputClass } from '../components/ui';
import { useConfirm } from '../components/Dialog';

const blank: SceneData = { narration: '', bubbles: [] };

export default function Editor() {
  const { id = '' } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SceneData>>({});
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState('A1');
  const [cast, setCast] = useState<Cast>({ characters: [], places: [] });
  const [portraitBusy, setPortraitBusy] = useState<Record<string, boolean>>({});

  async function drawPortrait(kind: CastKind, index: number) {
    const key = `${kind}:${index}`;
    setPortraitBusy((b) => ({ ...b, [key]: true }));
    setError(null);
    try {
      const res = await aiPortrait(id, kind, index);
      setCast(res.cast);
    } catch {
      setError('Could not draw the portrait. Save the cast first, then try again.');
    } finally {
      setPortraitBusy((b) => ({ ...b, [key]: false }));
    }
  }
  const [tab, setTab] = useState<'scenes' | 'cast'>('scenes');
  const [newNarration, setNewNarration] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [artBusy, setArtBusy] = useState<Record<string, boolean>>({});
  const [panels, setPanels] = useState<Record<number, Panel>>({});
  const [publishBusy, setPublishBusy] = useState(false);
  const [book, setBook] = useState<Book | null>(null);
  const [shared, setShared] = useState(false);
  const { requestConfirm, dialog } = useConfirm();

  async function refresh() {
    setScenes([]);
    setDrafts({});
    setBook(null);
    setPanels({});
    setArtBusy({});
    setShared(false);
    try {
      const res = await getProject(id);
      setProject(res.project);
      setScenes(res.scenes);
      setTitle(res.project.title);
      setDescription(res.project.description);
      setLevel(res.project.level);
      setCast(JSON.parse(res.project.cast_json) as typeof cast);
      const d: Record<string, SceneData> = {};
      for (const s of res.scenes) d[s.id] = parseScene(s);
      setDrafts(d);
    } catch {
      setError('Could not load the comic.');
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveProject() {
    setError(null);
    try {
      const res = await updateProject(id, { title, description, level });
      setProject(res.project);
    } catch {
      setError('Could not save the comic.');
    }
  }

  async function addScene() {
    setError(null);
    try {
      const res = await createScene(id, { narration: newNarration, bubbles: [] });
      setNewNarration('');
      setScenes((s) => [...s, res.scene]);
      setDrafts((d) => ({ ...d, [res.scene.id]: parseScene(res.scene) }));
    } catch {
      setError('Could not add the scene.');
    }
  }

  async function saveScene(sceneId: string) {
    setError(null);
    try {
      const res = await updateScene(id, sceneId, drafts[sceneId] ?? blank);
      setScenes((s) => s.map((x) => (x.id === sceneId ? res.scene : x)));
    } catch {
      setError('Could not save the scene.');
    }
  }

  async function removeScene(sceneId: string, sceneNumber: number) {
    const ok = await requestConfirm({
      title: 'Delete scene',
      message: `Delete scene ${sceneNumber}? This cannot be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    setError(null);
    try {
      await deleteScene(id, sceneId);
      setScenes((s) => s.filter((x) => x.id !== sceneId));
    } catch {
      setError('Could not delete the scene.');
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const order = scenes.map((s) => s.id);
    const j = index + dir;
    if (j < 0 || j >= order.length) return;
    [order[index], order[j]] = [order[j], order[index]];
    setError(null);
    try {
      setScenes((await reorderScenes(id, order)).scenes);
    } catch {
      setError('Could not reorder scenes.');
    }
  }

  function editBubble(sceneId: string, bi: number, field: 'speaker' | 'text', value: string) {
    setDrafts((d) => {
      const cur = d[sceneId] ?? blank;
      const bubbles = cur.bubbles.map((b, i) => (i === bi ? { ...b, [field]: value } : b));
      return { ...d, [sceneId]: { ...cur, bubbles } };
    });
  }

  async function saveCast() {
    setError(null);
    try {
      const clean = (list: Cast['characters']) => list.filter((e) => e.name.trim() !== '');
      const res = await updateProject(id, {
        cast_json: { characters: clean(cast.characters), places: clean(cast.places) },
      });
      setProject(res.project);
    } catch {
      setError('Could not save the cast.');
    }
  }

  async function finish() {
    setError(null);
    try {
      const res = await aiFinish(id);
      await refresh();
      if (res.failed.length > 0) {
        setError(`Some scenes need help: ${res.failed.map((f) => `#${f.scene_number} (${f.reason})`).join(', ')}`);
      }
    } catch {
      setError('3E Finish failed. Try again or write the scenes yourself.');
    }
  }

  async function generateSceneArt(scene: Scene) {
    setError(null);
    setArtBusy((b) => ({ ...b, [scene.id]: true }));
    try {
      const res = await aiArt(id, scene.scene_number);
      setPanels((p) => {
        const next = { ...p };
        for (const panel of res.panels) next[panel.scene_number] = panel;
        return next;
      });
    } catch {
      setError(`Art failed for scene ${scene.scene_number}.`);
    } finally {
      setArtBusy((b) => ({ ...b, [scene.id]: false }));
    }
  }

  async function publish() {
    setError(null);
    setPublishBusy(true);
    try {
      const res = await publishProject(id);
      setBook(res.book);
      setProject((p) => (p ? { ...p, status: 'published' } : p));
    } catch {
      setError('Publish failed.');
    } finally {
      setPublishBusy(false);
    }
  }

  async function simplifyScene(sceneId: string) {
    setError(null);
    try {
      const d = drafts[sceneId] ?? blank;
      const res = await aiSimplify(d.narration, level);
      const next = { ...d, narration: res.rewritten };
      const saved = await updateScene(id, sceneId, next);
      setScenes((s) => s.map((x) => (x.id === sceneId ? saved.scene : x)));
      setDrafts((all) => ({ ...all, [sceneId]: parseScene(saved.scene) }));
      if (!res.check.passed) {
        setError(`Still hard words: ${res.check.unknown.join(', ')}`);
      }
    } catch {
      setError('Simplify failed.');
    }
  }

  if (!project) {
    return (
      <Page title="Loading…">
        {error && <Alert>{error}</Alert>}
      </Page>
    );
  }

  return (
    <Page title={project.title}>
      <p className="-mt-2 text-sm">
        {project.level} <Badge status={project.status} />
      </p>
      <section aria-label="Comic details" className="flex flex-col gap-3 rounded-md border border-stone-200 p-3">
        <Field label="Title">
          <input maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Description">
          <input
            maxLength={2000}
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
          />
        </Field>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="sm:w-32">
            <Field label="Level">
              <select value={level} onChange={(e) => setLevel(e.target.value)} className={inputClass}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </Field>
          </div>
          <Button onClick={() => void saveProject()}>Save</Button>
        </div>
      </section>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Editor actions">
        <Button onClick={() => setTab('scenes')} aria-pressed={tab === 'scenes'} pressed={tab === 'scenes'}>Scenes</Button>
        <Button onClick={() => setTab('cast')} aria-pressed={tab === 'cast'} pressed={tab === 'cast'}>Cast</Button>
        <Button onClick={() => void finish()} variant="primary">3E Finish</Button>
        <Button onClick={() => void publish()} disabled={publishBusy}>
          {publishBusy ? 'Publishing…' : 'Publish'}
        </Button>
      </div>
      {(book || project.status === 'published') && (
        <p className="flex flex-wrap items-center gap-2 rounded-md bg-stone-100 px-3 py-2">
          Published{book ? ` · ${book.reading_level}` : ''}{' '}
          <Link to={`/read/${project.id}`} className="underline underline-offset-2">Read</Link>{' '}
          {book && (
            <Button
              onClick={() => {
                setShared(false);
                const url = `${window.location.origin}/s/${book.id}`;
                const done = () => setShared(true);
                if (navigator.share) {
                  navigator.share({ title: book.title, url }).then(done, () => {});
                } else {
                  navigator.clipboard.writeText(url).then(done, () => {});
                }
              }}
            >
              Share
            </Button>
          )}{' '}
          {shared && <span>Link ready to send.</span>}{' '}
          {book?.cover_url && <img src={book.cover_url} alt="Book cover" className="h-auto w-24" />}
        </p>
      )}
      {error && <Alert>{error}</Alert>}
      {dialog}
      {tab === 'scenes' ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="New scene narration">
                <input
                  maxLength={2000}
                  placeholder="New scene narration"
                  value={newNarration}
                  onChange={(e) => setNewNarration(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
            <Button onClick={() => void addScene()}>Add scene</Button>
          </div>
          {scenes.map((s, i) => {
            const d = drafts[s.id] ?? blank;
            return (
              <section key={s.id} aria-label={`Scene ${s.scene_number}`} className="flex flex-col gap-2 rounded-md border border-stone-300 bg-white p-3">
                <h2 className="flex items-center gap-2 font-display text-xl font-bold">
                  <span aria-hidden="true" className="inline-flex h-7 min-h-0 w-7 items-center justify-center rounded-full bg-accent-900 text-sm text-white">
                    {s.scene_number}
                  </span>
                  Scene {s.scene_number}
                </h2>
                <Field label="Narration">
                  <textarea
                    maxLength={2000}
                    rows={3}
                    value={d.narration}
                    onChange={(e) =>
                      setDrafts((all) => ({ ...all, [s.id]: { ...d, narration: e.target.value } }))
                    }
                    className={inputClass}
                  />
                </Field>
                {d.bubbles.map((b, bi) => (
                  <div key={bi} className="flex flex-col gap-2 rounded-md bg-stone-100 p-2 sm:flex-row sm:items-end">
                    <div className="sm:w-32">
                      <Field label="Speaker">
                        <input
                          maxLength={50}
                          placeholder="Speaker"
                          value={b.speaker}
                          onChange={(e) => editBubble(s.id, bi, 'speaker', e.target.value)}
                          className={inputClass}
                        />
                      </Field>
                    </div>
                    <div className="flex-1">
                      <Field label="Line">
                        <input
                          maxLength={500}
                          placeholder="Line"
                          value={b.text}
                          onChange={(e) => editBubble(s.id, bi, 'text', e.target.value)}
                          className={inputClass}
                        />
                      </Field>
                    </div>
                    <Button
                      variant="danger"
                      onClick={() =>
                        setDrafts((all) => ({
                          ...all,
                          [s.id]: { ...d, bubbles: d.bubbles.filter((_, k) => k !== bi) },
                        }))
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <Button
                  onClick={() =>
                    setDrafts((all) => ({
                      ...all,
                      [s.id]: { ...d, bubbles: [...d.bubbles, { speaker: '', text: '' }] },
                    }))
                  }
                >
                  Add bubble
                </Button>
                {panels[s.scene_number] && (
                  <img
                    src={panels[s.scene_number].image_url}
                    alt={`Scene ${s.scene_number} art`}
                    className="h-auto w-48"
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void saveScene(s.id)} variant="primary">Save scene</Button>
                  <Button onClick={() => void simplifyScene(s.id)}>Simplify</Button>
                  <Button onClick={() => void generateSceneArt(s)} disabled={!!artBusy[s.id]}>
                    {artBusy[s.id] ? 'Generating…' : 'Generate'}
                  </Button>
                  <Button onClick={() => void move(i, -1)} aria-label={`Move scene ${s.scene_number} up`}>Up</Button>
                  <Button onClick={() => void move(i, 1)} aria-label={`Move scene ${s.scene_number} down`}>Down</Button>
                  <Button onClick={() => void removeScene(s.id, s.scene_number)} variant="danger">Delete</Button>
                </div>
              </section>
            );
          })}
        </>
      ) : (
        <>
          {(['characters', 'places'] as const).map((kind) => (
            <section key={kind} aria-label={kind} className="flex flex-col gap-2 rounded-md border border-stone-200 p-3">
              <h2 className="text-xl font-bold capitalize">{kind}</h2>
              <ul className="flex flex-col gap-2">
                {cast[kind].map((c, ci) => (
                  <li key={ci} className="flex flex-col gap-2 rounded-md bg-stone-100 p-2 sm:flex-row sm:items-end">
                    {c.image_url ? (
                      <img
                        src={c.image_url}
                        alt={c.name ? `Portrait of ${c.name}` : 'Cast portrait'}
                        className="h-24 w-20 shrink-0 rounded object-cover"
                        loading="lazy"
                      />
                    ) : null}
                    <div className="sm:w-48">
                      <Field label="Name">
                        <input
                          maxLength={100}
                          placeholder={kind === 'characters' ? 'Name (e.g. Noy)' : 'Name (e.g. rice field)'}
                          value={c.name}
                          onChange={(e) =>
                            setCast((all) => ({
                              ...all,
                              [kind]: all[kind].map((x, k) => (k === ci ? { ...x, name: e.target.value } : x)),
                            }))
                          }
                          className={inputClass}
                        />
                      </Field>
                    </div>
                    <div className="flex-1">
                      <Field label="Looks">
                        <input
                          maxLength={500}
                          placeholder={
                            kind === 'characters'
                              ? 'Looks (e.g. 8-year-old, short black bob, yellow t-shirt, red backpack)'
                              : 'Looks (e.g. a rice field at sunrise)'
                          }
                          value={c.description ?? ''}
                          onChange={(e) =>
                            setCast((all) => ({
                              ...all,
                              [kind]: all[kind].map((x, k) =>
                                k === ci ? { ...x, description: e.target.value } : x,
                              ),
                            }))
                          }
                          className={inputClass}
                        />
                      </Field>
                    </div>
                    <Button
                      onClick={() => void drawPortrait(kind, ci)}
                      disabled={portraitBusy[`${kind}:${ci}`] === true || c.name.trim() === ''}
                      title={c.name.trim() === '' ? 'Name the entry before drawing its portrait' : 'Draw with AI (1 image call)'}
                    >
                      {portraitBusy[`${kind}:${ci}`] === true
                        ? 'Drawing…'
                        : c.image_url
                          ? 'Redraw'
                          : 'Draw'}
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() =>
                        setCast((all) => ({ ...all, [kind]: all[kind].filter((_, k) => k !== ci) }))
                      }
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
              <div>
                <Button
                  onClick={() => setCast((all) => ({ ...all, [kind]: [...all[kind], { name: '' }] }))}
                >
                  Add
                </Button>
              </div>
            </section>
          ))}
          <div>
            <Button onClick={() => void saveCast()} variant="primary">Save cast</Button>
          </div>
        </>
      )}
    </Page>
  );
}
