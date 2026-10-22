/**
 * 插件抽屉全局组「语音服务」(第 2 步 D4):跑语音模型的电脑。原来在语音页里(VoicePanel 的 ConnectionsGroup),
 * 功能一样:加 GPT-SoVITS / IndexTTS、改名字地址步数情绪强度、测试、有声音在用时不让删。
 * 每台的测试结果和左栏的状态字是同一份(抽屉打开时各测一次,PluginsDrawer 管)。
 */

import { debugApi, type TtsApiType, type TtsConnection, type TtsConnectionPatch } from '../../../lib/api';
import type { VoicePluginState } from '../../../plugins/useVoicePlugin';
import { CommitField, DeleteButton } from '../../pluginFields';
import { useRunner, type Notify } from '../../pluginRunner';
import { connectionLabel } from '../cardView';
import { PageHead, Section } from '../frame';
import { ttsSummary, type TtsTest } from '../globalStatus';
import { Tip } from '../Tip';

function testText(t: TtsTest | undefined): { text: string; ok: boolean | null } {
  if (t === undefined) return { text: '', ok: null };
  if (t === 'pending') return { text: '测试中…', ok: null };
  return t.ok ? { text: `通了 · ${t.ms} ms`, ok: true } : { text: `连不上:${t.error}`, ok: false };
}

export function TtsServicePage({
  voice,
  tests,
  onTest,
  notify,
}: {
  voice: VoicePluginState;
  /** 这次打开抽屉测出来的(和左栏同一份) */
  tests: Readonly<Record<string, TtsTest | undefined>>;
  onTest: (id: string) => void;
  notify: Notify;
}) {
  const [busy, run] = useRunner(notify, voice.refresh);
  const summary = ttsSummary(voice.connections, tests);

  const add = (api_type: TtsApiType) =>
    run('添加中', async () => {
      await debugApi.createTtsConnection(
        api_type === 'indextts'
          ? { name: 'IndexTTS', api_type, base_url: 'http://127.0.0.1:9890', emo_alpha: 1 }
          : { name: 'GPT-SoVITS', api_type, base_url: 'http://127.0.0.1:9880', sample_steps: 64 },
      );
    });

  const save = (c: TtsConnection, patch: TtsConnectionPatch) =>
    run('保存中', async () => {
      await debugApi.updateTtsConnection(c.id, patch);
    });

  const setSteps = (c: TtsConnection, v: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 4 || n > 128) {
      notify('error', '采样步数是 4 到 128 之间的整数');
      return Promise.resolve(false);
    }
    return save(c, { sample_steps: n });
  };

  const setAlpha = (c: TtsConnection, v: string) => {
    const n = Number(v);
    if (!(n >= 0 && n <= 1)) {
      notify('error', '情绪强度在 0 到 1 之间');
      return Promise.resolve(false);
    }
    return save(c, { emo_alpha: n });
  };

  return (
    <>
      <PageHead
        title="语音服务"
        tip="tts_service"
        inUse={{ on: summary.ok === true, text: summary.text }}
        tags={voice.connections.length > 1 ? [`${voice.connections.length} 台`] : []}
      />
      <Section
        title="连接"
        right={
          <>
            {busy && <span className="dw-muted">{busy}…</span>}
            <button type="button" className="btn small" disabled={!!busy} onClick={() => void add('gpt_sovits')}>
              + GPT-SoVITS
            </button>
            <button type="button" className="btn small" disabled={!!busy} onClick={() => void add('indextts')}>
              + IndexTTS-2.5
            </button>
          </>
        }
      >
        {voice.connections.length === 0 ? (
          <div className="dw-line">还没有语音服务。</div>
        ) : (
          voice.connections.map((c) => {
            const t = testText(tests[c.id]);
            return (
              <div key={c.id} className="dw-conn">
                <div className="dw-conn-head">
                  <span className={`dw-dot${t.ok === true ? ' on' : t.ok === false ? ' bad' : ''}`} aria-hidden="true" />
                  <span className="dw-conn-name">{connectionLabel(c)}</span>
                  <span className="dw-muted">{c.profile_count} 个声音在用</span>
                  <span className="dw-flex" />
                  {t.text && <span className={t.ok === false ? 'dw-bad' : 'dw-muted'}>{t.text}</span>}
                  <button
                    type="button"
                    className="btn small"
                    disabled={tests[c.id] === 'pending'}
                    onClick={() => onTest(c.id)}
                  >
                    测试
                  </button>
                  <Tip k="tts_test" />
                  <span title={c.profile_count > 0 ? '有声音在用这台,先在素材管理里给它们换一台' : undefined}>
                    <DeleteButton
                      disabled={!!busy || c.profile_count > 0}
                      onConfirm={() => void run('删除中', () => debugApi.deleteTtsConnection(c.id))}
                    />
                  </span>
                </div>
                <div className="dw-conn-fields">
                  <CommitField label="名字" value={c.name} onCommit={(v) => save(c, { name: v })} />
                  <CommitField
                    label="地址"
                    value={c.base_url}
                    placeholder={c.api_type === 'indextts' ? 'http://127.0.0.1:9890' : 'http://127.0.0.1:9880'}
                    onCommit={(v) => save(c, { base_url: v })}
                  />
                  {c.api_type === 'indextts' ? (
                    <CommitField label="情绪强度" value={String(c.emo_alpha)} placeholder="0.6" onCommit={(v) => setAlpha(c, v)} />
                  ) : (
                    <CommitField label="采样步数" value={String(c.sample_steps)} placeholder="64" onCommit={(v) => setSteps(c, v)} />
                  )}
                </div>
              </div>
            );
          })
        )}
      </Section>
    </>
  );
}
