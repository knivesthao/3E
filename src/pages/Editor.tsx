import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  createScene,
  deleteScene,
  getProject,
  parseScene,
  reorderScenes,
  updateProject,
  updateScene,
} from '../lib/api';
import { LEVELS } from '../lib/api';
import type { Project, Scene, SceneData } from '../lib/api';

const blank: SceneData = { narration: '', bubbles: [] };

export default function Editor() {
  const { id = '' } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SceneData>>({});
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState('A1');
  const [cast, setCast] = useState<{ characters: { name: string }[]; places: { name: string }[] }>({
    characters: [],
    places: [],
  });
  const [tab, setTab] = useState<'scenes' | 'cast'>('scenes');
  const [newNarration, setNewNarration] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
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
      const res = await updateProject(id, { cast_json: cast });
      setProject(res.project);
    } catch {
      setError('Could not save the cast.');
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
      </div>
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
                <div>
                  <button onClick={() => void saveScene(s.id)}>Save scene</button>
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
                    {c.name}
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
                onClick={() => {
                  const name = window.prompt(`New ${kind.slice(0, -1)} name:`)?.trim();
                  if (name) setCast((all) => ({ ...all, [kind]: [...all[kind], { name }] }));
                }}
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
