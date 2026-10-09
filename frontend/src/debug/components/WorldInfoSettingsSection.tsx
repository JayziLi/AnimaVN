import { useEffect, useState } from 'react';
import type { WorldInfoSettings } from '../lib/worldInfo';
import { WORLD_INFO_LIMITS, clampWorldInfoNumber } from '../lib/worldInfoSettings';

type NumberKey = keyof typeof WORLD_INFO_LIMITS;
type FlagKey = {
  [K in keyof WorldInfoSettings]: WorldInfoSettings[K] extends boolean ? K : never;
}[keyof WorldInfoSettings];

interface Props {
  settings: WorldInfoSettings;
  onChange: (next: WorldInfoSettings) => void;
}

/** 数字框:边打边存会把「1」→「12」中间那个 1 也存进去,所以失焦才提交 */
function NumberField({
  label,
  note,
  field,
  settings,
  onChange,
}: Props & { label: string; note: string; field: NumberKey }) {
  const [draft, setDraft] = useState(String(settings[field]));
  useEffect(() => setDraft(String(settings[field])), [settings, field]);

  const commit = () => {
    const value = clampWorldInfoNumber(field, draft);
    setDraft(String(value));
    if (value !== settings[field]) onChange({ ...settings, [field]: value });
  };

  return (
    <div className="sp-field wi-number">
      <span className="conn-label">{label}</span>
      <input
        className="conn-input"
        type="number"
        min={WORLD_INFO_LIMITS[field].min}
        max={WORLD_INFO_LIMITS[field].max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <span className="sp-group-note">{note}</span>
    </div>
  );
}

function Flag({
  label,
  note,
  field,
  settings,
  onChange,
}: Props & { label: string; note: string; field: FlagKey }) {
  const on = settings[field];
  return (
    <button className="sp-switch" onClick={() => onChange({ ...settings, [field]: !on })}>
      <span className={`block-toggle${on ? ' on' : ''}`}>
        <span className="knob" />
      </span>
      <span className="sp-switch-label">{label}</span>
      <span className="sp-switch-note">{note}</span>
    </button>
  );
}

/**
 * 「设置 › 世界书」。这些是全局默认值,条目可以单独覆盖其中几项。
 * 出厂值和酒馆一样 —— 从酒馆导进来的卡,不动这一页就该和在酒馆里表现一致。
 */
export function WorldInfoSettingsSection({ settings, onChange }: Props) {
  const shared = { settings, onChange };
  return (
    <>
      <div className="sp-group">
        <div className="sp-group-head">
          <span className="sp-group-title">扫描</span>
          <span className="sp-group-note">拿哪些文字去找关键词</span>
        </div>
        <div className="sp-duo-fields">
          <NumberField
            {...shared}
            field="scanDepth"
            label="扫描条数"
            note="只看最近这么多条消息。条目可以单独设"
          />
          <NumberField
            {...shared}
            field="minActivations"
            label="最少触发数"
            note="不够就往更早的消息找。0 = 关"
          />
          <NumberField
            {...shared}
            field="minActivationsDepthMax"
            label="最多找到第几条"
            note="配合上一项。0 = 不限"
          />
        </div>
        <Flag
          {...shared}
          field="includeNames"
          label="带上说话人的名字"
          note="每条消息按「名字: 内容」扫描,关键词可以写人名"
        />
      </div>

      <div className="sp-group">
        <div className="sp-group-head">
          <span className="sp-group-title">匹配</span>
          <span className="sp-group-note">条目可以单独设这两项</span>
        </div>
        <Flag
          {...shared}
          field="caseSensitive"
          label="区分大小写"
          note="关着时 API 和 api 算同一个词"
        />
        <Flag
          {...shared}
          field="matchWholeWords"
          label="全词匹配"
          note="英文词要独立成词才算,cat 不会命中 concatenate。对中文关键词没有影响"
        />
      </div>

      <div className="sp-group">
        <div className="sp-group-head">
          <span className="sp-group-title">递归</span>
          <span className="sp-group-note">
            触发的条目正文里如果提到别的条目的关键词,把那条也带出来
          </span>
        </div>
        <Flag {...shared} field="recursive" label="递归扫描" note="一直找到没有新条目为止" />
        <NumberField
          {...shared}
          field="maxRecursionSteps"
          label="最多几轮"
          note="0 = 不限。设了这项,「最少触发数」不生效"
        />
      </div>

      <div className="sp-group">
        <div className="sp-group-head">
          <span className="sp-group-title">预算</span>
          <span className="sp-group-note">
            世界书最多占多少。超出的条目不进提示词,顺序号大的先占位置
          </span>
        </div>
        <div className="sp-duo-fields">
          <NumberField
            {...shared}
            field="budgetPercent"
            label="占上下文的百分比"
            note="按输入框上方那条上下文预算算。预算关掉时这项不起作用"
          />
          <NumberField
            {...shared}
            field="budgetCap"
            label="封顶(token)"
            note="0 = 不封顶"
          />
        </div>
      </div>

      <div className="sp-group">
        <div className="sp-group-head">
          <span className="sp-group-title">互斥分组</span>
        </div>
        <Flag
          {...shared}
          field="useGroupScoring"
          label="按命中数挑"
          note="同组里命中关键词最多的留下;关着时按权重随机"
        />
      </div>
    </>
  );
}
