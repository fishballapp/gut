import { describe, expect, it } from 'vitest';
import { claim, sanitizeKeyPart } from './keys.ts';
import {
  appendPathSegment,
  collectComboboxOptions,
  collectSnapshot,
  landmarkLevelName,
  truncate,
} from './paths.ts';

describe('paths', () => {
  it('sanitizes key parts and claims unique keys', () => {
    expect(sanitizeKeyPart('Hello World! 123')).toBe('hello_world_123');
    expect(sanitizeKeyPart('   --test__ ')).toBe('test');
    expect(sanitizeKeyPart('')).toBe('item');

    const used = new Set<string>();
    expect(claim('action', used)).toBe('action');
    expect(claim('action', used)).toBe('action_2');
    expect(claim('action', used)).toBe('action_3');
  });

  it('maps landmark roles to descriptive names', () => {
    expect(landmarkLevelName('banner', 'Site')).toBe('Header "Site"');
    expect(landmarkLevelName('banner', undefined)).toBe('Header');
    expect(landmarkLevelName('navigation', 'Main')).toBe('Navigation "Main"');
    expect(landmarkLevelName('navigation', undefined)).toBe('Navigation');
    expect(landmarkLevelName('main', 'Dashboard')).toBe('Main content "Dashboard"');
    expect(landmarkLevelName('main', undefined)).toBe('Main content');
    expect(landmarkLevelName('contentinfo', 'Corporate')).toBe('Footer "Corporate"');
    expect(landmarkLevelName('contentinfo', undefined)).toBe('Footer');
    expect(landmarkLevelName('complementary', 'London')).toBe('Sidebar "London"');
    expect(landmarkLevelName('complementary', undefined)).toBe('Sidebar');
    expect(landmarkLevelName('search', 'Products')).toBe('Search "Products"');
    expect(landmarkLevelName('search', undefined)).toBe('Search');
    expect(landmarkLevelName('dialog', 'Confirm')).toBe('Dialog "Confirm"');
    expect(landmarkLevelName('dialog', undefined)).toBe('Dialog');
    expect(landmarkLevelName('form', 'Login')).toBe('Form "Login"');
    expect(landmarkLevelName('form', undefined)).toBe('Form');
    expect(landmarkLevelName('tablist', 'Settings')).toBe('Tabs "Settings"');
    expect(landmarkLevelName('tablist', undefined)).toBe('Tabs');
    expect(landmarkLevelName('region', 'Profile')).toBe('Region "Profile"');
    expect(landmarkLevelName('region', undefined)).toBeUndefined();
    expect(landmarkLevelName('generic', undefined)).toBeUndefined();
  });

  it('truncates long strings with ellipsis', () => {
    expect(truncate('Short string', 40)).toBe('Short string');
    expect(truncate('A'.repeat(45), 40)).toBe(`${'A'.repeat(39)}…`);
  });

  it('deduplicates path segments and truncated matches in appendPathSegment', () => {
    const path1 = appendPathSegment(['Header'], 'Navigation');
    expect(path1).toEqual(['Header', 'Navigation']);

    const path2 = appendPathSegment(path1, 'Navigation');
    expect(path2).toEqual(['Header', 'Navigation']);

    const longTitle = 'A'.repeat(50);
    const path3 = appendPathSegment(['Articles'], truncate(longTitle, 40));
    expect(path3).toEqual(['Articles', truncate(longTitle, 40)]);

    const path4 = appendPathSegment(path3, longTitle);
    expect(path4).toEqual(['Articles', truncate(longTitle, 40)]);
  });

  it("collects a combobox's options with their refs, skipping disabled ones", () => {
    const node = {
      role: 'combobox',
      children: [
        { role: 'option', name: 'Apple', ref: 'e1' },
        { role: 'option', name: 'Banana', disabled: true, ref: 'e2' },
        { role: 'option', name: 'Orange', ref: 'e3' },
        { role: 'option', name: 'Apple', ref: 'e4' },
        { role: 'option', name: 'Apple', ref: 'e5' },
      ],
    };

    const options = collectComboboxOptions(node);
    expect(options).toEqual([
      { name: 'Apple', ref: 'e1', index: 0 },
      { name: 'Orange', ref: 'e3', index: 2 },
      { name: 'Apple', ref: 'e4', index: 3 },
      { name: 'Apple', ref: 'e5', index: 4 },
    ]);
  });

  it('excludes combobox options from standalone candidates, while bare listbox options are standalone', () => {
    const roots = [
      {
        role: 'main',
        children: [
          {
            role: 'combobox',
            name: 'Select Fruit',
            ref: 'e1',
            children: [
              { role: 'option', name: 'Apple', ref: 'e2' },
              { role: 'option', name: 'Banana', ref: 'e3' },
            ],
          },
          {
            role: 'listbox',
            name: 'Bare Listbox',
            ref: 'e4',
            children: [
              { role: 'option', name: 'Carrot', ref: 'e5' },
              { role: 'option', name: 'Daikon', ref: 'e6' },
            ],
          },
        ],
      },
    ];

    const result = collectSnapshot(roots);

    // Fruit options should NOT appear as standalone candidates
    const appleCandidate = result.candidates.find(c => c.node.name === 'Apple');
    expect(appleCandidate).toBeUndefined();

    // The combobox itself IS a candidate and contains comboboxOptions
    const fruitCombobox = result.candidates.find(c => c.node.name === 'Select Fruit');
    expect(fruitCombobox).toBeDefined();
    expect(fruitCombobox?.comboboxOptions?.map(o => o.name)).toEqual(['Apple', 'Banana']);

    // Bare listbox options ARE standalone candidates
    const carrotCandidate = result.candidates.find(c => c.node.name === 'Carrot');
    expect(carrotCandidate).toBeDefined();
    expect(carrotCandidate?.node.role).toBe('option');

    const daikonCandidate = result.candidates.find(c => c.node.name === 'Daikon');
    expect(daikonCandidate).toBeDefined();
    expect(daikonCandidate?.node.role).toBe('option');
  });

  it('handles landmark and heading path rules without sibling leaks', () => {
    const roots = [
      {
        role: 'main',
        children: [
          { role: 'heading', name: 'Section A', level: 2 },
          { role: 'button', name: 'Btn 1', ref: 'e1' },
          {
            role: 'complementary',
            children: [
              { role: 'heading', name: 'Sidebar Heading', level: 2 },
              { role: 'button', name: 'Btn 2', ref: 'e2' },
            ],
          },
          { role: 'button', name: 'Btn 3', ref: 'e3' },
        ],
      },
    ];

    const result = collectSnapshot(roots);

    const btn1 = result.candidates.find(c => c.node.name === 'Btn 1');
    expect(btn1?.path).toEqual(['Main content', 'Section A']);

    const btn2 = result.candidates.find(c => c.node.name === 'Btn 2');
    expect(btn2?.path).toEqual(['Main content', 'Sidebar', 'Sidebar Heading']);

    // Btn 3 must keep Section A and not leak the Sidebar landmark or cleared state
    const btn3 = result.candidates.find(c => c.node.name === 'Btn 3');
    expect(btn3?.path).toEqual(['Main content', 'Section A']);
  });

  describe("naming a list's items", () => {
    const link = (name: string, ref: string) => ({ role: 'link', name, ref, url: '/' });
    const row = (...children: object[]) => ({ role: 'row', children });
    const pathsOf = (rows: object[]) =>
      collectSnapshot([{ role: 'table', children: rows }]).candidates.map(c => [
        ...c.path,
        c.node.name,
      ]);

    it('names an item by its longest control name, so a story is its title and not its "upvote"', () => {
      expect(
        pathsOf([
          row(link('upvote', 'e1'), link('A story title', 'e2')),
          row(link('upvote', 'e3'), link('Another story', 'e4')),
        ]),
      ).toEqual([
        ['A story title', 'upvote'],
        ['A story title', 'A story title'],
        ['Another story', 'upvote'],
        ['Another story', 'Another story'],
      ]);
    });

    it('leaves an item of one control, or of more than 12, unnamed', () => {
      const many = Array.from({ length: 13 }, (_, i) => link(`link ${i}`, `m${i}`));
      expect(pathsOf([row(link('Only', 'e1')), row(...many)]).map(path => path.length)).toEqual(
        Array.from({ length: 14 }, () => 1),
      );
    });

    it('names a lone article holding 2 to 12 controls without requiring siblings', () => {
      const loneArticle = {
        role: 'article',
        children: [link('Article Title', 'a1'), { role: 'button', name: 'Edit', ref: 'b1' }],
      };
      const { candidates } = collectSnapshot([loneArticle]);
      expect(candidates.map(c => [...c.path, c.node.name])).toEqual([
        ['Article Title', 'Article Title'],
        ['Article Title', 'Edit'],
      ]);
    });

    it('does not name a lone plain box holding controls without siblings', () => {
      const loneBox = {
        role: 'generic',
        children: [link('Box Title', 'a1'), { role: 'button', name: 'Edit', ref: 'b1' }],
      };
      const { candidates } = collectSnapshot([loneBox]);
      expect(candidates.map(c => [...c.path, c.node.name])).toEqual([['Box Title'], ['Edit']]);
    });

    it('names plain boxes whose controls have the same shape, like product cards', () => {
      const card = (name: string, n: number) => ({
        role: 'generic',
        children: [link(name, `n${n}`), { role: 'button', name: 'Add to cart', ref: `b${n}` }],
      });
      const { candidates } = collectSnapshot([
        {
          role: 'generic',
          children: [card('Sauce Labs Backpack', 1), card('Sauce Labs Bike Light', 2)],
        },
      ]);
      expect(candidates.map(c => [...c.path, c.node.name])).toEqual([
        ['Sauce Labs Backpack', 'Sauce Labs Backpack'],
        ['Sauce Labs Backpack', 'Add to cart'],
        ['Sauce Labs Bike Light', 'Sauce Labs Bike Light'],
        ['Sauce Labs Bike Light', 'Add to cart'],
      ]);
    });

    it('numbers siblings that would share a name, so their groups stay apart', () => {
      expect(
        pathsOf([
          row(link('2 hours ago', 'e1'), link('hide', 'e2')),
          row(link('2 hours ago', 'e3'), link('hide', 'e4')),
        ]).map(path => path[0]),
      ).toEqual(['2 hours ago', '2 hours ago', '2 hours ago (2)', '2 hours ago (2)']);
    });
    it('disambiguates sibling item names without suffix collisions (Alpha, Alpha, Alpha (2))', () => {
      const item = (title: string, id: string) => ({
        role: 'article',
        name: title,
        children: [
          { role: 'button', name: 'Edit', ref: `edit-${id}` },
          { role: 'button', name: 'Delete', ref: `del-${id}` },
        ],
      });
      const { candidates } = collectSnapshot([
        item('Alpha', '1'),
        item('Alpha', '2'),
        item('Alpha (2)', '3'),
      ]);
      expect(candidates.map(c => [...c.path, c.node.name])).toEqual([
        ['Alpha', 'Edit'],
        ['Alpha', 'Delete'],
        ['Alpha (2)', 'Edit'],
        ['Alpha (2)', 'Delete'],
        ['Alpha (2) (2)', 'Edit'],
        ['Alpha (2) (2)', 'Delete'],
      ]);
    });

    it('uses accessible name for named items, truncated to 40 characters', () => {
      const longTitle = 'This is a very long product name that exceeds forty characters';
      const itemA = {
        role: 'article',
        name: 'Product A',
        children: [
          { role: 'button', name: 'Edit', ref: 'e1' },
          { role: 'button', name: 'Delete', ref: 'd1' },
        ],
      };
      const itemB = {
        role: 'article',
        name: longTitle,
        children: [
          { role: 'button', name: 'Edit', ref: 'e2' },
          { role: 'button', name: 'Delete', ref: 'd2' },
        ],
      };
      const { candidates } = collectSnapshot([itemA, itemB]);
      expect(candidates.map(c => [...c.path, c.node.name])).toEqual([
        ['Product A', 'Edit'],
        ['Product A', 'Delete'],
        ['This is a very long product name that e…', 'Edit'],
        ['This is a very long product name that e…', 'Delete'],
      ]);
    });
  });
});
