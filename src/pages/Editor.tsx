import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  aiArt,
  aiFinish,
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
import type { Book, Panel, Project, Scene, SceneData } from '../lib/api';

const blank: SceneData = { narration: '', bubbles: [] };

export default function Editor() {
  const { id = '' } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SceneData>>({});
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState('A1');
  const [cast, setCast] = useState<{
    characters: { name: string; description?: string }[];
    places: { name: string; description?: string }[];
  }>({
    characters: [],
    places: [],
  });
  const [tab, setTab] = useState<'scenes' | 'cast'>('scenes');
  const [newNarration, setNewNarration] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [artBusy, setArtBusy] = useState<Record<string, boolean>>({});
  const [panels, setPanels] = useState<Record<number, Panel>>({});
  const [publishBusy, setPublishBusy] = useState(false);
  const [book, setBook] = useState<Book | null>(null);
  const [shared, setShared] = useState(false);

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

  async function removeScene(sceneId: string) {
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
      const clean = (list: { name: string; description?: string }[]) =>
        list.filter((e) => e.name.trim() !== '');
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

  if (!project) return <main><p>Loading…</p>{error && <p>{error}</p>}</main>;

  return (
    <main>
      <h1>{project.title}</h1>
      <div>
        <input maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        <input
          maxLength={2000}
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <select value={level} onChange={(e) => setLevel(e.target.value)}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <button onClick={() => void saveProject()}>Save</button>
      </div>
      <div>
        <button onClick={() => setTab('scenes')}>Scenes</button>
        <button onClick={() => setTab('cast')}>Cast</button>
        <button onClick={() => void finish()}>3E Finish</button>
        <button onClick={() => void publish()} disabled={publishBusy}>
          {publishBusy ? 'Publishing…' : 'Publish'}
        </button>
      </div>
      {(book || project.status === 'published') && (
        <p>
          Published{book ? ` · ${book.reading_level}` : ''}{' '}
          <Link to={`/read/${project.id}`}>Read</Link>{' '}
          {book && (
            <button
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
            </button>
          )}{' '}
          {shared && <span>Link ready to send.</span>}{' '}
          {book?.cover_url && <img src={book.cover_url} alt="Book cover" width={96} />}
        </p>
      )}
      {error && <p>{error}</p>}
      {tab === 'scenes' ? (
        <>
          <div>
            <input
              maxLength={2000}
              placeholder="New scene narration"
              value={newNarration}
              onChange={(e) => setNewNarration(e.target.value)}
            />
            <button onClick={() => void addScene()}>Add scene</button>
          </div>
          {scenes.map((s, i) => {
            const d = drafts[s.id] ?? blank;
            return (
              <section key={s.id}>
                <h3>Scene {s.scene_number}</h3>
                <textarea
                  maxLength={2000}
                  value={d.narration}
                  onChange={(e) =>
                    setDrafts((all) => ({ ...all, [s.id]: { ...d, narration: e.target.value } }))
                  }
                />
                {d.bubbles.map((b, bi) => (
                  <div key={bi}>
                    <input
                      maxLength={50}
                      placeholder="Speaker"
                      value={b.speaker}
                      onChange={(e) => editBubble(s.id, bi, 'speaker', e.target.value)}
                    />
                    <input
                      maxLength={500}
                      placeholder="Line"
                      value={b.text}
                      onChange={(e) => editBubble(s.id, bi, 'text', e.target.value)}
                    />
                    <button
                      onClick={() =>
                        setDrafts((all) => ({
                          ...all,
                          [s.id]: { ...d, bubbles: d.bubbles.filter((_, k) => k !== bi) },
                        }))
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  onClick={() =>
                    setDrafts((all) => ({
                      ...all,
                      [s.id]: { ...d, bubbles: [...d.bubbles, { speaker: '', text: '' }] },
                    }))
                  }
                >
                  Add bubble
                </button>
                {panels[s.scene_number] && (
                  <img src={panels[s.scene_number].image_url} alt={`Scene ${s.scene_number} art`} width={192} />
                )}
                <div>
                  <button onClick={() => void saveScene(s.id)}>Save scene</button>
                  <button onClick={() => void simplifyScene(s.id)}>Simplify</button>
                  <button onClick={() => void generateSceneArt(s)} disabled={!!artBusy[s.id]}>
                    {artBusy[s.id] ? 'Generating…' : 'Generate'}
                  </button>
                  <button onClick={() => void move(i, -1)}>Up</button>
                  <button onClick={() => void move(i, 1)}>Down</button>
                  <button onClick={() => void removeScene(s.id)}>Delete</button>
                </div>
              </section>
            );
          })}
        </>
      ) : (
        <>
          {(['characters', 'places'] as const).map((kind) => (
            <section key={kind}>
              <h3>{kind}</h3>
              <ul>
                {cast[kind].map((c, ci) => (
                  <li key={ci}>
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
                    />
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
                    />
                    <button
                      onClick={() =>
                        setCast((all) => ({ ...all, [kind]: all[kind].filter((_, k) => k !== ci) }))
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => setCast((all) => ({ ...all, [kind]: [...all[kind], { name: '' }] }))}
              >
                Add
              </button>
            </section>
          ))}
          <button onClick={() => void saveCast()}>Save cast</button>
        </>
      )}
    </main>
  );
}
