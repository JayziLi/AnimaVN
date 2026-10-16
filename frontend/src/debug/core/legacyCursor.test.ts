import { describe, expect, it } from 'vitest';
import { legacyCursorState, legacyEmotionBefore } from './legacyCursor';
import { ALT, asset, beat, ctxOf, hit, lensOf, resolverOf, sprite, TEST_FORM_NAMES } from './timeline.fixtures';

const SPRITES = [
  sprite('s1', '微笑', ['笑']),
  sprite('s2', '平静'),
  sprite('s3', `${ALT}·微笑`),
  sprite('s4', `${ALT}·害羞`),
];

describe('legacyCursorState · expressions', () => {
  it('starts on the first sprite and follows exact and model matches', () => {
    const beats = [beat('a0', 3, [hit('sprite', '平静', 1), hit('sprite', '嘟嘴', 2)])];
    const ctx = ctxOf({ sprites: SPRITES, resolve: resolverOf(SPRITES, { 嘟嘴: { state: 'model', label: '微笑', score: 0.7 } }) });
    expect(legacyCursorState(beats, 0, 0, ctx).spriteLabel).toBe('微笑');
    expect(legacyCursorState(beats, 0, 1, ctx).spriteLabel).toBe('平静');
    expect(legacyCursorState(beats, 0, 2, ctx).spriteLabel).toBe('微笑');
  });

  it('keeps the previous expression while a word is pending, and ignores tags before NPC lines', () => {
    const beats = [beat('a0', 3, [hit('sprite', '平静', 0), hit('sprite', '还在认', 1), hit('sprite', '笑', 2, '路人')])];
    const ctx = ctxOf({ sprites: SPRITES, resolve: resolverOf(SPRITES, { 还在认: { state: 'pending' } }) });
    expect(legacyCursorState(beats, 0, 1, ctx).spriteLabel).toBe('平静');
    expect(legacyCursorState(beats, 0, 2, ctx).spriteLabel).toBe('平静');
  });

  it('uses the raw word when the card has no sprites and the model gave up', () => {
    const beats = [beat('a0', 1, [hit('sprite', '嘟嘴', 0)])];
    expect(legacyCursorState(beats, 0, 0, ctxOf({ sprites: [] })).spriteLabel).toBe('嘟嘴');
  });

  it('applies tags at the end of a reply only from the next reply on', () => {
    const beats = [beat('a0', 2, [hit('sprite', '平静', -1)]), beat('a1', 1, [])];
    const ctx = ctxOf({ sprites: SPRITES });
    expect(legacyCursorState(beats, 0, 1, ctx).spriteLabel).toBe('微笑');
    expect(legacyCursorState(beats, 1, 0, ctx).spriteLabel).toBe('平静');
    expect(legacyEmotionBefore(beats, 1, ctx)).toBe('平静');
  });
});

describe('legacyCursorState · scene', () => {
  const ASSETS = [
    asset({ id: 'b1', kind: 'bg', label: '客厅', bgm_id: 'm1' }),
    asset({ id: 'b2', kind: 'bg', label: '卧室' }),
    asset({ id: 'm1', kind: 'bgm', label: '日常' }),
    asset({ id: 'm2', kind: 'bgm', label: '夜晚' }),
    asset({ id: 'c1', kind: 'cg', label: '拥抱' }),
    asset({ id: 'c1v', kind: 'cg', label: '平静', parent_id: 'c1' }),
  ];

  it('starts on the first background with its default music, and switches music with the background', () => {
    const beats = [beat('a0', 3, [hit('bgm', '夜晚', 0), hit('bg', '卧室', 1), hit('bg', '客厅', 2)])];
    const ctx = ctxOf({ sprites: SPRITES, sceneAssets: ASSETS });
    const at = (line: number) => legacyCursorState(beats, 0, line, ctx).scene;
    expect([at(0).bg?.label, at(0).bgm?.label]).toEqual(['客厅', '夜晚']);
    expect([at(1).bg?.label, at(1).bgm?.label]).toEqual(['卧室', '夜晚']);
    expect([at(2).bg?.label, at(2).bgm?.label, at(2).bgmFrom]).toEqual(['客厅', '日常', 'scene']);
  });

  it('shows the CG variant named after the expression, and closes the CG on an off word', () => {
    const beats = [beat('a0', 3, [hit('cg', '拥抱', 0), hit('sprite', '平静', 1), hit('cg', '收起', 2)])];
    const ctx = ctxOf({ sprites: SPRITES, sceneAssets: ASSETS });
    expect(legacyCursorState(beats, 0, 0, ctx).cgFrame?.id).toBe('c1');
    expect(legacyCursorState(beats, 0, 1, ctx).cgFrame?.id).toBe('c1v');
    expect(legacyCursorState(beats, 0, 2, ctx).scene.cg).toBeNull();
  });
});

describe('legacyCursorState · forms', () => {
  const ASSETS = [
    asset({ id: 'c1', kind: 'cg', label: '散步', forms: [TEST_FORM_NAMES.normal] }),
    asset({ id: 'c1v', kind: 'cg', label: '微笑', parent_id: 'c1' }),
  ];

  it('shows the form default when the expression belongs to the other form, but keeps the label before conversion', () => {
    const beats = [beat('a0', 2, [hit('sprite', '微笑', 0)])];
    const lens = lensOf([{ entryId: 'a0', line: 1, form: 'alt' }], ['a0'], SPRITES);
    const ctx = ctxOf({ sprites: SPRITES, forms: lens });
    expect(legacyCursorState(beats, 0, 0, ctx)).toMatchObject({ shownLabel: '微笑', form: 'normal' });
    expect(legacyCursorState(beats, 0, 1, ctx)).toMatchObject({
      spriteLabel: '微笑',
      shownLabel: `${ALT}·微笑`,
      form: 'alt',
    });
  });

  it('closes a CG when the form switches away and does not bring it back', () => {
    const beats = [beat('a0', 4, [hit('cg', '散步', 0)])];
    const lens = lensOf(
      [
        { entryId: 'a0', line: 1, form: 'alt' },
        { entryId: 'a0', line: 3, form: 'normal' },
      ],
      ['a0'],
      SPRITES,
    );
    const ctx = ctxOf({ sprites: SPRITES, sceneAssets: ASSETS, forms: lens });
    expect(legacyCursorState(beats, 0, 0, ctx).scene.cg?.id).toBe('c1');
    expect(legacyCursorState(beats, 0, 1, ctx).scene.cg).toBeNull();
    expect(legacyCursorState(beats, 0, 3, ctx).scene.cg).toBeNull();
  });

  it('ignores a CG tag written where its form is not allowed', () => {
    const beats = [beat('a0', 2, [hit('cg', '散步', 1)])];
    const lens = lensOf([{ entryId: 'a0', line: 0, form: 'alt' }], ['a0'], SPRITES);
    const ctx = ctxOf({ sprites: SPRITES, sceneAssets: ASSETS, forms: lens });
    expect(legacyCursorState(beats, 0, 1, ctx).scene.cg).toBeNull();
  });
});
