/**
 * 插件抽屉角色组「外语」(第 2 步 D5、P4,画布 V6Lang):日语配音、中文字幕。发不发跟着这张卡的主声音走(问号里说),
 * 页头写主声音是不是日语,「在用」小块写这次发 / 这次发 · 精简版 / 这次不发(core/sendPlan.ts 的 langStatus,
 * 和组装用的是同一份);「这次发出去的」(P5)放在常用上面:精简版删掉的字画删除线、后面跟「这次不发」,
 * 不发时整段变灰、上面一行写原因;常用只有「字幕」(原来的「显示日语」);高级是块的原文和精简版原文。
 * 这次怎么发只算得出当前聊天这张卡的:抽屉里看的是别的卡时,「在用」照旧按它的主声音是不是日语写,
 * 「这次发出去的」只写一行「只看得到当前聊天这张卡的」。
 */

import { langStatus, type LangStatus, type SendView } from '../../../core/sendPlan';
import { textDiff } from '../../../core/textDiff';
import { DEFAULT_LANG_BLOCK_PROMPT, DEFAULT_LANG_BLOCK_PROMPT_JEV, isJaLang, type LangPluginConfig } from '../../../plugins/lang';
import { SettingRow } from '../../settings/SettingRow';
import { headTags } from '../cardView';
import { Advanced, PageFooter, PageHead, Section } from '../frame';
import { Tip } from '../Tip';
import { TIPS } from '../tips';
import type { CardView } from '../useCardView';
import { inUseOf, type AdvOpen, type PageLinks } from './pageModel';
import { TabTitle } from './shared';
import './sendPages.css';

const STATUS_TEXT = { send: '这次发', short: '这次发 · 精简版', skip: '这次不发' } as const;

/** 精简版删掉的一段:删除线,后面跟「这次不发」;前后的换行留在外面,小块挨着删掉的字 */
function Struck({ text }: { text: string }) {
  const lead = text.startsWith('\n') ? '\n' : '';
  const trail = text.length > lead.length && text.endsWith('\n') ? '\n' : '';
  const body = text.slice(lead.length, text.length - trail.length);
  if (!body.trim()) return <>{text}</>;
  return (
    <>
      {lead}
      <s className="dw-struck">{body}</s>
      <span className="dw-send-skip">
        这次不发
        <Tip k="lang_trim" />
      </span>
      {trail}
    </>
  );
}

/** 「这次发出去的」:发 → 原文;精简版 → 原文上画出删掉的;不发 → 整段灰、上面写原因 */
function SentText({ status, lang }: { status: LangStatus; lang: SendView['lang'] }) {
  if (status.state === 'skip') {
    return (
      <>
        <div className="dw-send-why">{'tip' in status.why ? TIPS[status.why.tip] : status.why.text}</div>
        <div className="dw-send-text off" aria-label="这次不发的外语块">
          {lang.full}
        </div>
      </>
    );
  }
  if (status.state === 'send') return <div className="dw-send-text">{lang.full}</div>;
  return (
    <div className="dw-send-text">
      {textDiff(lang.full, lang.short).map((part, i) => (part.kept ? <span key={i}>{part.text}</span> : <Struck key={i} text={part.text} />))}
    </div>
  );
}

export function LangPage(p: {
  view: CardView;
  card: { id: string; name: string } | null;
  config: LangPluginConfig;
  onChangeConfig: (next: LangPluginConfig) => void;
  /** 当前聊天这张卡这次怎么发;不传就照旧按主声音写「在用」 */
  send?: SendView;
  links: PageLinks;
  advOpen: AdvOpen;
}) {
  const { view, card, config, onChangeConfig, send } = p;
  const facts = view.facts;
  const name = card?.name || '这张卡';
  const main = facts?.mainVoice ?? null;
  const ja = main !== null && isJaLang(main.text_lang);
  const changed = config.blockPrompt !== DEFAULT_LANG_BLOCK_PROMPT;
  // 看的就是当前聊天这张卡:照这次的发送计划写
  const current = send !== undefined && send.card !== null && card !== null && send.card.id === card.id;
  const status = current ? langStatus(send.plan, { hasPreset: send.presetName !== null, mainVoiceLang: send.mainVoiceLang }) : null;
  const inUse = status
    ? { on: status.state !== 'skip', text: STATUS_TEXT[status.state] }
    : facts
      ? inUseOf(name, ja)
      : null;

  return (
    <>
      <PageHead title="外语" inUse={inUse} tags={facts ? headTags('lang', facts, []) : []} tagTip="lang_auto" />

      {send && (
        <Section
          title="这次发出去的"
          tip="preview_lang"
          right={status && status.state !== 'skip' && status.auto ? <span className="dw-chip">自动补</span> : undefined}
        >
          <div className="dw-send-body">
            {status ? (
              <SentText status={status} lang={send.lang} />
            ) : (
              <div className="dw-muted">只看得到当前聊天这张卡{send.card ? `(${send.card.name})` : ''}的。</div>
            )}
          </div>
        </Section>
      )}

      <Section title="常用">
        <SettingRow
          label="字幕"
          tip="subtitle"
          control={{
            kind: 'segmented',
            options: [
              { value: 'both', label: '日中双语' },
              { value: 'zh', label: '只显示中文' },
            ],
          }}
          value={config.showJa ? 'both' : 'zh'}
          default="both"
          onChange={(v) => onChangeConfig({ ...config, showJa: v === 'both' })}
        />
      </Section>

      <Advanced
        pageId="lang"
        open={p.advOpen}
        tabs={[
          { id: 'block', name: '块的原文', badge: changed ? '改过' : undefined },
          { id: 'short', name: '精简版原文' },
        ]}
        render={(tab) =>
          tab === 'block' ? (
            <div id="pl-prompt-lang" className="dw-tab-stack">
              <TabTitle
                title="「外语指令 · 插件」块的正文"
                right={
                  <button
                    type="button"
                    className="btn small"
                    disabled={!changed}
                    onClick={() => onChangeConfig({ ...config, blockPrompt: DEFAULT_LANG_BLOCK_PROMPT })}
                  >
                    恢复默认模板
                  </button>
                }
              />
              <textarea
                className="text-input pl-wide pl-textarea"
                rows={12}
                value={config.blockPrompt}
                spellCheck={false}
                aria-label="外语块的正文"
                onChange={(e) => onChangeConfig({ ...config, blockPrompt: e.target.value })}
              />
            </div>
          ) : (
            <div className="dw-tab-stack">
              <TabTitle title="标签交给 Jev 时发的精简版" tip="lang_short" />
              {/* 改过的模板:去掉单独一行的标签和讲标签的句子(plugins/jev.ts 的 jevLangPrompt) */}
              {changed && !send ? (
                <div className="dw-muted">改过的模板去掉单独一行的标签和讲标签的句子,别的照原文发。</div>
              ) : (
                <pre className="pl-preview">{changed && send ? send.lang.short : DEFAULT_LANG_BLOCK_PROMPT_JEV}</pre>
              )}
            </div>
          )
        }
      />

      <PageFooter links={[{ text: `卡编辑器 · ${name}的声音`, onClick: () => p.links.studio('voice') }]} />
    </>
  );
}
