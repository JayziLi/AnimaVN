import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VNMenu } from './VNMenu';

const render = (leaving?: boolean) =>
  renderToStaticMarkup(
    <VNMenu page="log" onPage={() => {}} charName="星绘" chatName="夜路" onClose={() => {}} onTitle={() => {}} leaving={leaving}>
      <p>body</p>
    </VNMenu>,
  );

describe('VNMenu', () => {
  it('opens as a plain dialog', () => {
    expect(render()).not.toContain('leaving');
  });
  it('paper follows the theme (white by default)', () => {
    expect(render()).toContain('class="vn-menu av-day"');
  });
  it('gets the leaving class while it fades out', () => {
    expect(render(true)).toContain('class="vn-menu av-day leaving"');
  });
});
