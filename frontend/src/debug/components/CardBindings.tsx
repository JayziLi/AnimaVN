/**
 * 角色卡编辑器头像下面的「绑定」一栏:这张卡用哪个玩家身份(人设)、哪套预设、哪个立绘包。
 * 选这张卡时自动换过去;在这里改了当场就换。
 *
 * 和人设抽屉里的「绑定到当前角色卡」、预设面板里的同名勾选改的是同一份数据
 * (lib/personaBinding.ts、lib/presetBinding.ts)。立绘包列出所有的包:这张卡挂着的在前,
 * 其他包在后,选了其他包就挂到这张卡上并换过去(用户:每套立绘是一个素材包,哪张卡都能直接用)。
 * 调试台和视觉小说菜单的角色卡页共用。
 */

interface Option {
  id: string;
  name: string;
}

interface Props {
  personas: readonly Option[];
  /** 这张卡绑的人设;null = 没绑 */
  personaId: string | null;
  /** 没绑时用的默认人设名;没设默认人设是 null */
  defaultPersonaName: string | null;
  presets: readonly Option[];
  /** 这张卡绑的预设;null = 没绑 */
  presetId: string | null;
  /** 这张卡挂着的立绘包,按顺序 */
  spritePacks: readonly Option[];
  /** 没挂在这张卡上的其他立绘包;选了就挂上并换过去 */
  otherSpritePacks: readonly Option[];
  /** 正在用的立绘包;一个都没挂时是 null */
  spritePackId: string | null;
  busy: boolean;
  onPersona: (id: string | null) => void;
  onPreset: (id: string | null) => void;
  onSpritePack: (id: string) => void;
}

export function CardBindings({
  personas,
  personaId,
  defaultPersonaName,
  presets,
  presetId,
  spritePacks,
  otherSpritePacks,
  spritePackId,
  busy,
  onPersona,
  onPreset,
  onSpritePack,
}: Props) {
  return (
    <div className="card-bind">
      <label className="card-bind-row">
        <span className="card-bind-label">玩家身份</span>
        <select
          className="select"
          value={personaId ?? ''}
          disabled={busy}
          onChange={(e) => onPersona(e.target.value || null)}
        >
          <option value="">
            {defaultPersonaName ? `不绑定(用默认人设「${defaultPersonaName}」)` : '不绑定(不自动切换)'}
          </option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="card-bind-row">
        <span className="card-bind-label">预设</span>
        <select
          className="select"
          value={presetId ?? ''}
          disabled={busy}
          onChange={(e) => onPreset(e.target.value || null)}
        >
          <option value="">不绑定(用对话记的预设)</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="card-bind-row">
        <span className="card-bind-label">立绘包</span>
        <select
          className="select"
          value={spritePackId ?? ''}
          disabled={busy || spritePacks.length + otherSpritePacks.length === 0}
          onChange={(e) => {
            if (e.target.value) onSpritePack(e.target.value);
          }}
        >
          {spritePackId === null && <option value="">没有立绘包</option>}
          {otherSpritePacks.length === 0 ? (
            spritePacks.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))
          ) : (
            <>
              {spritePacks.length > 0 && (
                <optgroup label="这张卡的">
                  {spritePacks.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="其他立绘包(选了就给这张卡用)">
                {otherSpritePacks.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            </>
          )}
        </select>
      </label>
    </div>
  );
}
