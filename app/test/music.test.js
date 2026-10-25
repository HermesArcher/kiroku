'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { listMusic, trackOf } = require('../main/music');

test('trackOf: artist/title split, order prefix dropped, numbers in names kept', () => {
  assert.deepEqual(trackOf('01 - Artist - Title.mp3'), { artist: 'Artist', title: 'Title' });
  assert.deepEqual(trackOf('02. Some_Song.flac'), { artist: '', title: 'Some Song' });
  assert.deepEqual(trackOf('50 Cent - In Da Club.mp3'), { artist: '50 Cent', title: 'In Da Club' });
  assert.deepEqual(trackOf('1979.ogg'), { artist: '', title: '1979' });
});

test('listMusic: audio only, natural order, file URLs; missing folder = empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiroku-music-'));
  for (const n of ['10 - B - Ten.mp3', '2 - A - Two #1.m4a', 'README.txt', 'cover.jpg']) fs.writeFileSync(path.join(dir, n), '');
  const url = (n) => pathToFileURL(path.join(dir, n)).href;
  assert.deepEqual(listMusic(dir), [
    { src: url('2 - A - Two #1.m4a'), artist: 'A', title: 'Two #1' },
    { src: url('10 - B - Ten.mp3'), artist: 'B', title: 'Ten' },
  ]);
  assert.match(url('2 - A - Two #1.m4a'), /Two%20%231\.m4a$/); // '#' must not cut the URL into a fragment
  assert.deepEqual(listMusic(path.join(dir, 'nope')), []);
});
