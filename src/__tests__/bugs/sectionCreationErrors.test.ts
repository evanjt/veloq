import {
  createSectionFromIndices,
  setSectionName,
} from '../../../modules/veloqrs/src/delegates/sections/mutations';

function readyHost(create: jest.Mock) {
  return {
    ready: true,
    engine: { sections: () => ({ create }) },
    timed: (_label: string, run: () => string) => run(),
    notify: jest.fn(),
  } as unknown as Parameters<typeof createSectionFromIndices>[0];
}

describe('section creation', () => {
  it('hands the engine the range and no points, and announces the new section', () => {
    const create = jest.fn(() => 's1');
    const host = readyHost(create);

    expect(createSectionFromIndices(host, 'a1', 2, 5, 'Ride', 'Col')).toBe('s1');

    expect(create).toHaveBeenCalledWith('Ride', 'Col', 'a1', 2, 5);
    expect(host.notify).toHaveBeenCalledWith('sections');
    expect(host.notify).toHaveBeenCalledWith('groups');
  });

  it('sends an empty name as none', () => {
    const create = jest.fn(() => 's1');

    createSectionFromIndices(readyHost(create), 'a1', 0, 1, 'Ride', '');

    expect(create).toHaveBeenCalledWith('Ride', undefined, 'a1', 0, 1);
  });

  it('lets an engine refusal through and creates on the next call', () => {
    const create = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Parse error: Section must have at least 2 points');
      })
      .mockImplementationOnce(() => 's2');
    const host = readyHost(create);

    expect(() => createSectionFromIndices(host, 'a1', 3, 3, 'Ride', undefined)).toThrow(
      'at least 2 points'
    );
    expect(host.notify).not.toHaveBeenCalled();
    expect(createSectionFromIndices(host, 'a1', 3, 4, 'Ride', undefined)).toBe('s2');
  });

  it('does nothing before the engine is ready', () => {
    const create = jest.fn();
    const host = { ...readyHost(create), ready: false } as ReturnType<typeof readyHost>;

    expect(createSectionFromIndices(host, 'a1', 0, 1, 'Ride', undefined)).toBe('');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('section rename outcome', () => {
  function renameHost(setName: () => void) {
    return {
      ready: true,
      engine: { sections: () => ({ setName }) },
      timed: (_label: string, run: () => void) => run(),
      notify: jest.fn(),
    } as unknown as Parameters<typeof setSectionName>[0];
  }

  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('reports a name another section shows as taken', () => {
    const host = renameHost(() => {
      throw new Error('Database error: Another section is already named Col');
    });
    expect(setSectionName(host, 's1', 'Col')).toBe('nameTaken');
  });

  it('reports any other engine failure as failed, and a write as saved', () => {
    const failing = renameHost(() => {
      throw new Error('Database error: disk full');
    });
    expect(setSectionName(failing, 's1', 'Col')).toBe('failed');
    expect(
      setSectionName(
        renameHost(() => {}),
        's1',
        'Col'
      )
    ).toBe('saved');
  });
});
