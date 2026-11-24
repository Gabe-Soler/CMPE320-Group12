import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchActivities, fetchLocations, type Location } from '../api'
import {
  classFillStats,
  detectGreenClassBlocks,
  detectTimetableGrid,
  entriesFromClassBlocks,
  extractEmbeddedImage,
  extractPdfBytes,
  extractPdfFile,
  isClassFill,
  isCredibleClassBlock,
  isNearWhite,
  ocrWordsToItems,
  pageNeedsOcr,
  parseTimetable,
  PdfExtractError,
  rectIou,
  type ClassRect,
  type Raster,
} from './parseTimetable'
import {
  buildingNameFromClassroom,
  clearSchedule,
  dateWeekday,
  extractTimeRange,
  formatClock,
  freePeriods,
  gapLandmarkCopy,
  isComplete,
  kingstonStamp,
  landmarksForFreePeriod,
  loadSchedule,
  matchLandmark,
  newId,
  normalizeEntry,
  normalizeOcrNoise,
  overlappingPairs,
  parseClock,
  parseComponent,
  parseCourse,
  parseDate,
  parseWeekdays,
  resolveLandmark,
  saveSchedule,
  scheduleSearchFromGap,
  STORAGE_KEY,
  type FreePeriod,
  type PdfTextItem,
  type ScheduleEntry,
} from './time'

describe('parseClock', () => {
  it('reads 24-hour and 12-hour times', () => {
    expect(parseClock('09:30')).toEqual({ ok: true, minute: 9 * 60 + 30 })
    expect(parseClock('13:00')).toEqual({ ok: true, minute: 13 * 60 })
    expect(parseClock('9:30 AM')).toEqual({ ok: true, minute: 9 * 60 + 30 })
    expect(parseClock('9:30AM')).toEqual({ ok: true, minute: 9 * 60 + 30 })
    expect(parseClock('11:30am')).toEqual({ ok: true, minute: 11 * 60 + 30 })
    expect(parseClock('12:00 PM')).toEqual({ ok: true, minute: 12 * 60 })
    expect(parseClock('12:00 AM')).toEqual({ ok: true, minute: 0 })
  })

  it('repairs common OCR time substitutions', () => {
    expect(normalizeOcrNoise('B:30AM - 9:30AM')).toMatch(/8:30AM/)
    expect(normalizeOcrNoise('11:304M')).toBe('11:30AM')
    expect(normalizeOcrNoise('12:00FM')).toBe('12:00PM')
  })

  it('does not guess AM/PM for a single-digit hour', () => {
    expect(parseClock('9:30')).toEqual({ ok: false, reason: 'ambiguous' })
    expect(parseClock('11:00')).toEqual({ ok: true, minute: 11 * 60 })
  })
})

describe('ranges and dates', () => {
  it('parses a split 12-hour range', () => {
    const range = extractTimeRange('9:30AM -\n11:30AM')
    expect(range.start).toEqual({ ok: true, minute: 570 })
    expect(range.end).toEqual({ ok: true, minute: 690 })
  })

  it('parses 24-hour ranges', () => {
    const range = extractTimeRange('13:00 - 14:30')
    expect(range.start).toEqual({ ok: true, minute: 13 * 60 })
    expect(range.end).toEqual({ ok: true, minute: 14 * 60 + 30 })
  })

  it('parses calendar dates', () => {
    expect(parseDate('Nov 17, 2026')).toBe('2026-11-17')
    expect(parseDate('2026-11-17')).toBe('2026-11-17')
  })

  it('formats HH:MM', () => {
    expect(formatClock(570)).toBe('09:30')
  })
})

describe('weekdays and courses', () => {
  it('reads names, abbreviations, and MWF', () => {
    expect(parseWeekdays('Monday')).toEqual([0])
    expect(parseWeekdays('Thurs')).toEqual([3])
    expect(parseWeekdays('MWF')).toEqual([0, 2, 4])
    expect(parseWeekdays('M/W/F')).toEqual([0, 2, 4])
    expect(parseWeekdays('TR')).toEqual([1, 3])
  })

  it('reads course codes and components', () => {
    expect(parseCourse('CISC 320 - 002')).toMatchObject({ courseCode: 'CISC 320', section: '002' })
    expect(parseCourse('MATH 121')).toMatchObject({ courseCode: 'MATH 121' })
    expect(parseCourse('ELEC 221')).toMatchObject({ courseCode: 'ELEC 221' })
    expect(parseCourse('Biosciences Complex 1101').courseCode).toBeUndefined()
    expect(parseCourse('Chernoff Hall AUD').courseCode).toBeUndefined()
    expect(parseComponent('Tutorial')).toBe('Tutorial')
    expect(parseComponent('LEC')).toBe('Lecture')
    expect(parseComponent('Lab')).toBe('Lab')
  })
})

function cls(partial: Partial<ScheduleEntry> & Pick<ScheduleEntry, 'days' | 'startTime' | 'endTime'>): ScheduleEntry {
  return normalizeEntry({
    id: newId(),
    title: 'Class',
    repeatsWeekly: true,
    source: 'manual',
    warnings: [],
    confidence: 'high',
    ...partial,
  })
}

describe('freePeriods', () => {
  const monday = '2026-11-16' // a Monday
  const classes = [
    cls({ days: [0], startTime: '09:00', endTime: '10:00', location: 'Ellis Hall', title: 'A' }),
    cls({ days: [0], startTime: '13:00', endTime: '14:00', location: 'Kingston Hall', title: 'B' }),
    cls({ days: [0], startTime: '16:00', endTime: '17:00', location: 'Goodwin Hall', title: 'C' }),
  ]

  it('finds gaps between classes', () => {
    const gaps = freePeriods(classes, { date: monday, includeEndsOfDay: false })
    expect(gaps.map((g) => [g.startMinute, g.endMinute])).toEqual([
      [10 * 60, 13 * 60],
      [14 * 60, 16 * 60],
    ])
    expect(gaps[0].fromLocation).toBe('Ellis Hall')
    expect(gaps[0].toLocation).toBe('Kingston Hall')
    expect(gaps[0].fromTitle).toBe('A')
    expect(gaps[0].toTitle).toBe('B')
  })

  it('merges overlapping and back-to-back classes', () => {
    const overlap = [
      cls({ days: [0], startTime: '09:00', endTime: '11:00', title: 'A' }),
      cls({ days: [0], startTime: '10:30', endTime: '12:00', title: 'B' }),
      cls({ days: [0], startTime: '12:00', endTime: '13:00', title: 'C' }),
    ]
    const gaps = freePeriods(overlap, { date: monday, includeEndsOfDay: false, minGapMinutes: 15 })
    expect(gaps).toHaveLength(0)
    expect(overlappingPairs(overlap, monday)).toHaveLength(1)
  })

  it('returns the daytime window when there are no classes', () => {
    const gaps = freePeriods([], { date: monday, dayStartMinute: 8 * 60, dayEndMinute: 18 * 60 })
    expect(gaps).toHaveLength(1)
    expect(gaps[0].minutes).toBe(10 * 60)
  })

  it('honours a one-week date restriction', () => {
    const oneOff = cls({
      days: [0],
      startTime: '09:00',
      endTime: '10:00',
      startDate: monday,
      repeatsWeekly: false,
      title: 'Quiz',
    })
    expect(freePeriods([oneOff], { date: monday, includeEndsOfDay: false })).toHaveLength(0)
    expect(freePeriods([oneOff], { date: '2026-11-23', includeEndsOfDay: false })).toHaveLength(0)
    expect(freePeriods([oneOff], { date: '2026-11-23', includeEndsOfDay: true })[0].minutes).toBeGreaterThan(0)
  })

  it('uses adjacent classes on the selected date, not another weekday', () => {
    const mondayClass = cls({
      days: [0],
      startTime: '09:00',
      endTime: '10:00',
      location: 'Ellis Hall',
      repeatsWeekly: true,
    })
    const tuesdayClass = cls({
      days: [1],
      startTime: '13:00',
      endTime: '14:00',
      location: 'Kingston Hall',
      repeatsWeekly: true,
    })
    const gaps = freePeriods([mondayClass, tuesdayClass], { date: monday, includeEndsOfDay: true })
    const afterMorning = gaps.find((item) => item.fromLocation === 'Ellis Hall')
    expect(afterMorning?.toLocation).toBeUndefined()
    expect(afterMorning?.toEntryId).toBeUndefined()
  })

  it('respects a term date range on a weekly class', () => {
    const term = cls({
      days: [0],
      startTime: '09:00',
      endTime: '10:00',
      startDate: '2026-11-16',
      endDate: '2026-11-20',
      repeatsWeekly: true,
      location: 'Ellis Hall',
    })
    expect(freePeriods([term], { date: '2026-11-16', includeEndsOfDay: false })).toHaveLength(0)
    expect(freePeriods([term], { date: '2026-11-23', includeEndsOfDay: false })).toHaveLength(0)
    expect(freePeriods([term], { date: '2026-11-23', includeEndsOfDay: true })[0].fromLocation).toBeUndefined()
  })
})

describe('validation and Kingston time', () => {
  it('blocks incomplete entries from being confirmed', () => {
    expect(isComplete({ title: 'X', days: [], startTime: '09:00', endTime: '10:00' })).toBe(false)
    expect(isComplete({ title: 'X', days: [0], startTime: '9:30', endTime: '10:30' })).toBe(false)
    expect(isComplete({ title: 'X', days: [0], startTime: '09:00', endTime: '08:00' })).toBe(false)
    expect(isComplete({ title: 'CISC 320', days: [0], startTime: '09:30', endTime: '11:30' })).toBe(true)
  })

  it('drops stale missing-course warnings once the class has times and a day', () => {
    const fixed = normalizeEntry({
      id: 'a',
      title: 'CISC 474',
      courseCode: 'CISC 474',
      days: [0],
      startTime: '08:30',
      endTime: '09:30',
      repeatsWeekly: false,
      source: 'pdf',
      warnings: ['missing-course', 'missing-end', 'incomplete'],
      confidence: 'low',
    })
    expect(fixed.warnings).not.toContain('missing-course')
    expect(fixed.warnings).not.toContain('missing-end')
    expect(isComplete(fixed)).toBe(true)
  })

  it('uses America/Toronto rather than the host timezone for civil dates', () => {
    const winter = kingstonStamp(new Date('2026-01-15T16:30:00Z'))
    expect(winter.date).toBe('2026-01-15')
    const dstEnd = kingstonStamp(new Date('2025-11-02T06:30:00Z'))
    expect(dstEnd.date).toBe('2025-11-02')
    expect(dateWeekday('2026-11-16')).toBe(0)
    expect(dateWeekday('2026-11-17')).toBe(1)
  })
})

describe('schedule storage', () => {
  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('round-trips confirmed entries', () => {
    saveSchedule([
      {
        id: newId(),
        title: 'CISC 320 · Tutorial',
        courseCode: 'CISC 320',
        days: [0],
        startTime: '09:30',
        endTime: '11:30',
        location: 'Ellis Hall 319',
        repeatsWeekly: false,
        source: 'pdf',
        warnings: [],
        confidence: 'high',
      },
    ])
    const loaded = loadSchedule()
    expect(loaded?.entries).toHaveLength(1)
    expect(loaded?.entries[0].courseCode).toBe('CISC 320')
  })

  it('ignores unsupported blobs instead of throwing', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(loadSchedule()).toBeNull()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, entries: [] }))
    expect(loadSchedule()).toBeNull()
  })

  it('clears a saved schedule', () => {
    saveSchedule([])
    clearSchedule()
    expect(loadSchedule()).toBeNull()
  })
})

const buildings: Location[] = [
  { id: 'ellis-hall', name: 'Ellis Hall' },
  { id: 'kingston-hall', name: 'Kingston Hall' },
  { id: 'dunning-hall', name: 'Dunning Hall' },
  { id: 'biosciences-complex', name: 'Biosciences Complex' },
  { id: 'anywhere', name: 'Anywhere' },
]

function gap(partial: Partial<FreePeriod> & Pick<FreePeriod, 'fromEntryId' | 'toEntryId'>): FreePeriod {
  return {
    date: '2026-11-16',
    weekday: 0,
    startMinute: 10 * 60,
    endMinute: 13 * 60,
    minutes: 180,
    fromLocation: 'Ellis Hall 319',
    toLocation: 'Kingston Hall 108',
    ...partial,
  }
}

describe('gap copy', () => {
  it('describes activities that fit the break, including walk to class', () => {
    expect(gapLandmarkCopy('before-first').help).toMatch(/from the activity to class/)
    expect(gapLandmarkCopy('before-first').toLabel).not.toMatch(/first class/i)
    expect(gapLandmarkCopy('between').help).toMatch(/from the activity to the next class/)
    expect(gapLandmarkCopy('after-last').toPlaceholder).toBe('No required destination')
  })
})

describe('automatic start and destination', () => {
  it('selects previous and next class buildings for a break between classes', () => {
    const auto = landmarksForFreePeriod(
      gap({ fromEntryId: 'a', toEntryId: 'b' }),
      buildings,
    )
    expect(auto.kind).toBe('between')
    expect(auto.fromId).toBe('ellis-hall')
    expect(auto.toId).toBe('kingston-hall')
    expect(auto.requiresFrom).toBe(false)
    expect(auto.requiresTo).toBe(false)
  })

  it('uses no required destination after the final class', () => {
    const auto = landmarksForFreePeriod(
      gap({
        fromEntryId: 'last',
        toEntryId: undefined,
        fromLocation: 'Dunning Hall 11',
        toLocation: undefined,
        startMinute: 16 * 60,
        endMinute: 22 * 60,
        minutes: 6 * 60,
      }),
      buildings,
    )
    expect(auto.kind).toBe('after-last')
    expect(auto.fromId).toBe('dunning-hall')
    expect(auto.toId).toBe('')
    expect(auto.hasNextClass).toBe(false)
    expect(auto.requiresTo).toBe(false)
  })

  it('plans around the first class without asking for a start landmark', () => {
    const auto = landmarksForFreePeriod(
      gap({
        fromEntryId: undefined,
        toEntryId: 'first',
        fromLocation: undefined,
        toLocation: 'Ellis Hall 319',
        startMinute: 8 * 60,
        endMinute: 9 * 60,
        minutes: 60,
      }),
      buildings,
    )
    expect(auto.kind).toBe('before-first')
    expect(auto.fromId).toBe('anywhere')
    expect(auto.requiresFrom).toBe(false)
    expect(auto.toId).toBe('ellis-hall')
    expect(auto.requiresTo).toBe(false)
  })

  it('uses Biosciences Complex from the timetable as the walk-to-class destination', () => {
    const auto = landmarksForFreePeriod(
      gap({
        fromEntryId: undefined,
        toEntryId: 'first',
        fromLocation: undefined,
        toLocation: 'Biosciences Complex 1102',
        startMinute: 8 * 60,
        endMinute: 11 * 60 + 30,
        minutes: 210,
      }),
      buildings,
    )
    expect(auto.kind).toBe('before-first')
    expect(auto.requiresFrom).toBe(false)
    expect(auto.toId).toBe('biosciences-complex')
    expect(auto.requiresTo).toBe(false)
  })

  it('asks the student when a class building is unknown', () => {
    const auto = landmarksForFreePeriod(
      gap({ fromEntryId: 'a', toEntryId: 'b', fromLocation: 'Goodes Hall', toLocation: 'Kingston Hall 108' }),
      buildings,
    )
    expect(auto.fromId).toBe('')
    expect(auto.requiresFrom).toBe(true)
    expect(auto.from.unresolved).toBe(true)
    expect(auto.toId).toBe('kingston-hall')
  })
})

describe('search submission', () => {
  it('sends destination, until, and a 5-minute buffer between classes', () => {
    const result = scheduleSearchFromGap(
      gap({ fromEntryId: 'a', toEntryId: 'b' }),
      'ellis-hall',
      'kingston-hall',
      buildings,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.search.at).toBe('2026-11-16T10:00')
    expect(result.search.locationId).toBe('ellis-hall')
    expect(result.search.destinationId).toBe('kingston-hall')
    expect(result.search.until).toBe('13:00')
    expect(result.search.buffer).toBe(5)
    expect(result.search.scheduleAware).toBe(true)
  })

  it('omits destination and buffer after the last class', () => {
    const result = scheduleSearchFromGap(
      gap({
        fromEntryId: 'last',
        toEntryId: undefined,
        toLocation: undefined,
        startMinute: 16 * 60,
        endMinute: 22 * 60,
        minutes: 360,
      }),
      'ellis-hall',
      '',
      buildings,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.search.destinationId).toBeUndefined()
    expect(result.search.buffer).toBe(0)
    expect(result.search.until).toBe('22:00')
  })

  it('blocks search when required landmarks are unresolved', () => {
    const missingStart = scheduleSearchFromGap(gap({ fromEntryId: 'a', toEntryId: 'b' }), '', 'kingston-hall', buildings)
    expect(missingStart.ok).toBe(false)
    const missingNext = scheduleSearchFromGap(gap({ fromEntryId: 'a', toEntryId: 'b' }), 'ellis-hall', '', buildings)
    expect(missingNext.ok).toBe(false)
  })

  it('does not treat Anywhere as a starting landmark between classes', () => {
    const result = scheduleSearchFromGap(gap({ fromEntryId: 'a', toEntryId: 'b' }), 'anywhere', 'kingston-hall', buildings)
    expect(result.ok).toBe(false)
  })

  it('searches before the first class using the timetable destination only', () => {
    const morning = gap({
      fromEntryId: undefined,
      toEntryId: 'first',
      fromLocation: undefined,
      toLocation: 'Biosciences Complex 1102',
      startMinute: 8 * 60,
      endMinute: 11 * 60 + 30,
      minutes: 210,
    })
    const auto = landmarksForFreePeriod(morning, buildings)
    const result = scheduleSearchFromGap(morning, auto.fromId, auto.toId, buildings)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.search.locationId).toBe('anywhere')
    expect(result.search.destinationId).toBe('biosciences-complex')
    expect(result.search.locationName).toBe('Biosciences Complex')
    expect(result.search.buffer).toBe(5)
    expect(result.search.until).toBe('11:30')
  })

  it('keeps a manual destination when the student overrides the same break', () => {
    const auto = landmarksForFreePeriod(gap({ fromEntryId: 'a', toEntryId: 'b' }), buildings)
    const result = scheduleSearchFromGap(
      gap({ fromEntryId: 'a', toEntryId: 'b' }),
      auto.fromId,
      'dunning-hall',
      buildings,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.search.destinationId).toBe('dunning-hall')
  })

  it('updates start and destination when a different free period is selected', () => {
    const first = landmarksForFreePeriod(gap({ fromEntryId: 'a', toEntryId: 'b' }), buildings)
    const second = landmarksForFreePeriod(
      gap({
        fromEntryId: 'b',
        toEntryId: undefined,
        fromLocation: 'Kingston Hall 108',
        toLocation: undefined,
      }),
      buildings,
    )
    expect(first.fromId).toBe('ellis-hall')
    expect(first.toId).toBe('kingston-hall')
    expect(second.fromId).toBe('kingston-hall')
    expect(second.toId).toBe('')
  })
})

const halls: Location[] = [
  { id: 'ellis-hall', name: 'Ellis Hall' },
  { id: 'kingston-hall', name: 'Kingston Hall' },
  { id: 'walter-light', name: 'Walter Light Hall' },
  { id: 'stirling-hall', name: 'Stirling Hall' },
  { id: 'jeffery-hall', name: 'Jeffery Hall' },
  { id: 'dunning-hall', name: 'Dunning Hall' },
  { id: 'macdonald-hall', name: 'Macdonald Hall' },
  { id: 'chernoff-hall', name: 'Chernoff Hall' },
  { id: 'dupuis-hall', name: 'Dupuis Hall' },
  { id: 'beamish-munro', name: 'Beamish-Munro Hall' },
  { id: 'biosciences-complex', name: 'Biosciences Complex' },
  { id: 'goodwin-hall', name: 'Goodwin Hall' },
  { id: 'anywhere', name: 'Anywhere' },
]

describe('building aliases', () => {
  const cases: [string, string][] = [
    ['Ellis Hall 319', 'ellis-hall'],
    ['Kingston Hall 108', 'kingston-hall'],
    ['Walter Light Hall AUD', 'walter-light'],
    ['Stirling Hall C', 'stirling-hall'],
    ['Jeffery Hall 126', 'jeffery-hall'],
    ['Dunning Hall 11', 'dunning-hall'],
    ['Macdonald Hall', 'macdonald-hall'],
    ['Chernoff Hall AUD', 'chernoff-hall'],
    ['Dupuis Hall AUD', 'dupuis-hall'],
    ['Beamish Munro Hall', 'beamish-munro'],
    ['Biosciences Complex 1102', 'biosciences-complex'],
    ['Bioscience Complex 1101', 'biosciences-complex'],
  ]

  it.each(cases)('maps %s to %s', (text, id) => {
    const resolved = resolveLandmark(text, halls)
    expect(resolved.unresolved).toBe(false)
    expect(resolved.landmarkId).toBe(id)
    expect(matchLandmark(text, halls)?.id).toBe(id)
  })

  it('keeps the classroom string after stripping room numbers', () => {
    expect(buildingNameFromClassroom('Ellis Hall 319')).toBe('ellis hall')
    expect(resolveLandmark('Dunning Hall 11', halls).displayLocation).toBe('Dunning Hall 11')
  })

  it('does not match buildings that are not landmarks', () => {
    expect(resolveLandmark('Goodes Hall 102', halls).unresolved).toBe(true)
    expect(matchLandmark('Anywhere', halls)).toBeUndefined()
  })
})

function item(text: string, x: number, y: number, page = 1): PdfTextItem {
  return { text, x, y, page, width: text.length * 6, height: 12 }
}

describe('Queen\'s weekly grid', () => {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const headers = days.map((name, i) => item(`${name} Nov ${17 + i}, 2026`, 120 + i * 100, 30))
  const times = [8, 9, 10, 11, 12].map((hour) => item(`${hour}:00`, 20, 80 + (hour - 8) * 50))

  const cisc320 = [
    item('CISC 320 - 002', 125, 155),
    item('Tutorial', 125, 170),
    item('9:30AM -', 125, 185),
    item('11:30AM', 125, 200),
    item('Ellis Hall 319', 125, 215),
  ]
  const cisc474 = [
    item('CISC 474 - 001', 125, 95),
    item('Lecture', 125, 110),
    item('8:30AM -', 125, 125),
    item('9:30AM', 125, 140),
    item('Kingston Hall 101', 125, 148),
  ]

  it('extracts the two Monday class examples', () => {
    const result = parseTimetable([...headers, ...times, ...cisc474, ...cisc320])
    expect(result.layout).toBe('queens-week')
    expect(result.entries).toHaveLength(2)
    const byCode = Object.fromEntries(result.entries.map((e) => [e.courseCode, e]))
    expect(byCode['CISC 320']).toMatchObject({
      component: 'Tutorial',
      days: [0],
      startTime: '09:30',
      endTime: '11:30',
      location: 'Ellis Hall 319',
      section: '002',
      startDate: '2026-11-17',
      repeatsWeekly: false,
    })
    expect(byCode['CISC 474']).toMatchObject({
      component: 'Lecture',
      days: [0],
      startTime: '08:30',
      endTime: '09:30',
      location: 'Kingston Hall 101',
      startDate: '2026-11-17',
    })
  })

  it('keeps lecture and tutorial for the same course separate', () => {
    const lab = [
      item('CISC 320 - 003', 225, 155),
      item('Laboratory', 225, 170),
      item('9:30AM -', 225, 185),
      item('11:30AM', 225, 200),
      item('Goodwin Hall 230', 225, 215),
    ]
    const result = parseTimetable([...headers, ...times, ...cisc320, ...lab])
    const cisc = result.entries.filter((e) => e.courseCode === 'CISC 320')
    expect(cisc).toHaveLength(2)
    expect(cisc.map((e) => e.component).sort()).toEqual(['Lab', 'Tutorial'])
  })

  it('flags missing end time instead of inventing duration', () => {
    const incomplete = [item('PHYS 115', 125, 300), item('Lecture', 125, 315), item('2:00PM', 125, 330)]
    const result = parseTimetable([...headers, ...incomplete])
    const phys = result.entries.find((e) => e.courseCode === 'PHYS 115')
    expect(phys?.warnings).toContain('missing-end')
    expect(phys?.confidence).toBe('low')
  })
})

describe('table and linear layouts', () => {
  it('reads a list with weekday columns', () => {
    const rows = [
      item('Course', 40, 40),
      item('Days', 200, 40),
      item('Time', 320, 40),
      item('MATH 121 Lecture', 40, 70),
      item('MWF', 200, 70),
      item('09:30-10:30', 320, 70),
      item('Jeffery Hall', 420, 70),
    ]
    const result = parseTimetable(rows)
    expect(result.entries[0]).toMatchObject({
      courseCode: 'MATH 121',
      days: [0, 2, 4],
      startTime: '09:30',
      endTime: '10:30',
    })
  })

  it('does not invent a location', () => {
    const result = parseTimetable([item('MECH 230 MWF 13:00-14:00', 40, 80)])
    expect(result.entries[0].location).toBeUndefined()
    expect(result.entries[0].warnings).toContain('missing-location')
  })

  it('returns an unknown layout when nothing looks like a timetable', () => {
    const result = parseTimetable([item('Hello campus map', 10, 10)])
    expect(result.layout).toBe('unknown')
    expect(result.entries).toHaveLength(0)
  })
})

describe('entries from colour class blocks', () => {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  const headers = days.map((name, i) => item(`${name} Nov ${17 + i}, 2026`, 80 + i * 90, 20))
  const times = [8, 9, 10, 11, 12, 13].map((hour, i) => item(`${hour}:00`, 8, 60 + i * 40))

  it('keeps a genuine green block even when OCR text is empty', () => {
    const result = entriesFromClassBlocks({
      blocks: [{ rect: { x: 70, y: 80, w: 70, h: 50 }, text: '' }],
      items: [...headers, ...times],
      pageWidth: 600,
      pageHeight: 400,
    })
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].title).toBe('Unknown class')
    expect(result.entries[0].warnings).toContain('missing-course')
    expect(result.entries[0].days).toEqual([0])
  })

  it('splits one visual blob when OCR finds two course codes', () => {
    const result = entriesFromClassBlocks({
      blocks: [
        {
          rect: { x: 70, y: 80, w: 80, h: 120 },
          text: 'CISC 474 - 001 Lecture 8:30AM - 9:30AM Kingston Hall 101\nCOMM 493 - 001 Lecture 10:00AM - 11:30AM Goodes Hall 102',
        },
      ],
      items: [...headers, ...times],
      pageWidth: 600,
      pageHeight: 400,
    })
    expect(result.entries).toHaveLength(2)
    expect(result.entries.map((entry) => entry.courseCode).sort()).toEqual(['CISC 474', 'COMM 493'])
  })

  it('does not drop later classes if an earlier block has no readable text', () => {
    const result = entriesFromClassBlocks({
      blocks: [
        { rect: { x: 70, y: 80, w: 70, h: 40 }, text: '' },
        {
          rect: { x: 160, y: 80, w: 70, h: 40 },
          text: 'CISC 465 - 001 Lecture 8:30AM - 9:30AM Dunning Hall 11',
        },
      ],
      items: [...headers, ...times],
      pageWidth: 600,
      pageHeight: 400,
    })
    expect(result.entries.length).toBe(2)
    expect(result.entries.some((entry) => entry.courseCode === 'CISC 465')).toBe(true)
    expect(result.entries.some((entry) => entry.warnings.includes('missing-course'))).toBe(true)
  })

  it('does not treat building names as course codes', () => {
    const result = entriesFromClassBlocks({
      blocks: [
        {
          rect: { x: 70, y: 80, w: 80, h: 70 },
          text: 'CISC 332 - 001 Lecture 8:30AM - 9:30AM Biosciences Complex 1101',
        },
      ],
      items: [...headers, ...times],
      pageWidth: 600,
      pageHeight: 400,
    })
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].courseCode).toBe('CISC 332')
    expect(result.entries[0].location).toMatch(/Complex 1101/i)
  })

  it('splits three consecutive course headers in one crop', () => {
    const result = entriesFromClassBlocks({
      blocks: [
        {
          rect: { x: 70, y: 80, w: 80, h: 180 },
          text: 'CISC 324 - 001 Lecture 2:30PM - 3:30PM Kingston Hall 104\nCISC 352 - 001 Lecture 3:30PM - 4:30PM Chernoff Hall AUD\nLLCU 328 - 001 Seminar 4:30PM - 5:30PM Biosciences Complex 1102',
        },
      ],
      items: [...headers, ...times],
      pageWidth: 600,
      pageHeight: 400,
    })
    expect(result.entries.map((entry) => entry.courseCode).sort()).toEqual(['CISC 324', 'CISC 352', 'LLCU 328'])
  })

  it('keeps missing times editable instead of inventing them without a grid', () => {
    const result = entriesFromClassBlocks({
      blocks: [{ rect: { x: 70, y: 80, w: 70, h: 50 }, text: 'GPHY 102 - 001 Lecture Kingston Hall 104' }],
      items: headers,
      pageWidth: 600,
      pageHeight: 400,
    })
    expect(result.entries[0].courseCode).toBe('GPHY 102')
    expect(result.entries[0].warnings).toContain('missing-start')
    expect(result.entries[0].warnings).toContain('missing-end')
  })
})

const SCHEDULE_CLASS_BOXES = [
  { id: 'mon-cisc-474', day: 0, x: 66, y: 62, w: 76, h: 72 },
  { id: 'mon-comm-493', day: 0, x: 66, y: 152, w: 76, h: 130 },
  { id: 'tue-cisc-465-am', day: 1, x: 144, y: 62, w: 76, h: 72 },
  { id: 'tue-cisc-474', day: 1, x: 144, y: 208, w: 76, h: 74 },
  { id: 'tue-cisc-472', day: 1, x: 144, y: 344, w: 76, h: 62 },
  { id: 'wed-comm-493', day: 2, x: 222, y: 62, w: 77, h: 90 },
  { id: 'wed-cisc-465', day: 2, x: 222, y: 208, w: 77, h: 74 },
  { id: 'thu-cisc-474', day: 3, x: 300, y: 134, w: 77, h: 74 },
  { id: 'thu-cisc-472', day: 3, x: 300, y: 282, w: 77, h: 62 },
  { id: 'fri-cisc-465', day: 4, x: 378, y: 134, w: 78, h: 74 },
  { id: 'fri-cisc-472', day: 4, x: 378, y: 406, w: 78, h: 62 },
]

function solidRaster(width: number, height: number, rgb: [number, number, number]): Raster {
  const data = new Uint8Array(width * height * 3)
  for (let i = 0; i < data.length; i += 3) {
    data[i] = rgb[0]
    data[i + 1] = rgb[1]
    data[i + 2] = rgb[2]
  }
  return { data, width, height, channels: 3 }
}

function paint(raster: Raster, x: number, y: number, w: number, h: number, rgb: [number, number, number]) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const i = (yy * raster.width + xx) * 3
      raster.data[i] = rgb[0]
      raster.data[i + 1] = rgb[1]
      raster.data[i + 2] = rgb[2]
    }
  }
}

const schedulePdfPath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'schedule.pdf')
const describePdf = existsSync(schedulePdfPath) ? describe : describe.skip

async function scheduleRaster(): Promise<Raster> {
  const pdfjs = await import('pdfjs-dist')
  const path = schedulePdfPath
  const data = new Uint8Array(await readFile(path))
  const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise
  const page = await pdf.getPage(1)
  const image = await extractEmbeddedImage(page as never, pdfjs)
  const destroy = (pdf as { destroy?: () => Promise<void> | void }).destroy
  if (typeof destroy === 'function') await destroy.call(pdf)
  if (!image) throw new Error('missing image')
  return image
}

describe('class fill classifier', () => {
  it('accepts olive calendar fills and rejects white/gray', () => {
    expect(isClassFill(181, 199, 115)).toBe(true)
    expect(isClassFill(255, 255, 255)).toBe(false)
    expect(isNearWhite(255, 255, 255)).toBe(true)
    expect(isClassFill(200, 200, 200)).toBe(false)
  })

  it('rejects a white rectangle as a class block', () => {
    const raster = solidRaster(200, 120, [255, 255, 255])
    paint(raster, 40, 20, 70, 50, [252, 252, 248])
    expect(isCredibleClassBlock(raster, { x: 40, y: 20, w: 70, h: 50 })).toBe(false)
    expect(detectGreenClassBlocks(raster)).toHaveLength(0)
  })

  it('keeps a green block even with text-like holes', () => {
    const raster = solidRaster(400, 200, [255, 255, 255])
    paint(raster, 80, 40, 70, 55, [181, 199, 115])
    paint(raster, 90, 50, 50, 8, [40, 40, 40])
    const blocks = detectGreenClassBlocks(raster)
    expect(blocks.length).toBe(1)
    expect(isCredibleClassBlock(raster, blocks[0])).toBe(true)
  })

  it('does not merge green blocks in neighbouring columns', () => {
    const raster = solidRaster(400, 200, [255, 255, 255])
    paint(raster, 50, 40, 60, 50, [181, 199, 115])
    paint(raster, 130, 40, 60, 50, [181, 199, 115])
    const blocks = detectGreenClassBlocks(raster)
    expect(blocks.length).toBe(2)
    expect(Math.abs(blocks[0].x - blocks[1].x)).toBeGreaterThan(40)
  })

  it('keeps a tall multi-row class as one block', () => {
    const raster = solidRaster(300, 260, [255, 255, 255])
    paint(raster, 60, 40, 70, 140, [181, 199, 115])
    const blocks = detectGreenClassBlocks(raster)
    expect(blocks.length).toBe(1)
    expect(blocks[0].h).toBeGreaterThan(100)
  })

  it('splits stacked classes in the same column when a white gap separates them', () => {
    const raster = solidRaster(300, 280, [255, 255, 255])
    paint(raster, 60, 40, 70, 70, [181, 199, 115])
    paint(raster, 60, 130, 70, 70, [181, 199, 115])
    const blocks = detectGreenClassBlocks(raster)
    expect(blocks.length).toBe(2)
    expect(Math.abs(blocks[0].y - blocks[1].y)).toBeGreaterThan(40)
  })

  it('keeps a small green class that would be easy to over-filter', () => {
    const raster = solidRaster(300, 160, [255, 255, 255])
    paint(raster, 70, 50, 40, 28, [181, 199, 115])
    const blocks = detectGreenClassBlocks(raster)
    expect(blocks.length).toBe(1)
    expect(blocks[0].h).toBeGreaterThanOrEqual(20)
  })

  it('still reports a green block when interior text is unreadable', () => {
    const raster = solidRaster(300, 180, [255, 255, 255])
    paint(raster, 70, 40, 70, 60, [181, 199, 115])
    paint(raster, 80, 48, 50, 6, [30, 30, 30])
    paint(raster, 80, 60, 50, 6, [30, 30, 30])
    paint(raster, 80, 72, 50, 6, [30, 30, 30])
    const blocks = detectGreenClassBlocks(raster)
    expect(blocks.length).toBe(1)
    expect(isCredibleClassBlock(raster, blocks[0])).toBe(true)
  })
})

function matchGroundTruth(detected: ClassRect[]) {
  const unused = detected.map((_, i) => i)
  const matches = SCHEDULE_CLASS_BOXES.map((truth) => {
    let bestI = -1
    let best = 0
    for (const index of unused) {
      const iou = rectIou(truth, detected[index])
      if (iou > best) {
        best = iou
        bestI = index
      }
    }
    if (bestI >= 0) unused.splice(unused.indexOf(bestI), 1)
    return { truth, detected: bestI >= 0 ? detected[bestI] : undefined, iou: best }
  })
  return { matches, unmatched: unused.map((i) => detected[i]) }
}

describePdf('schedule.pdf class blocks', () => {
  it('detects green classes and rejects empty white cells', async () => {
    const raster = await scheduleRaster()
    const blocks = detectGreenClassBlocks(raster)
    for (const block of blocks) {
      const stats = classFillStats(raster, block)
      expect(stats.greenRatio).toBeGreaterThanOrEqual(0.28)
      expect(stats.whiteRatio).toBeLessThanOrEqual(0.5)
    }
    const columns = new Set(blocks.map((block) => Math.round(block.x / 35)))
    expect(columns.size).toBe(5)
    const sameColumn = blocks.filter((block) => Math.abs(block.x - blocks[0].x) < 20)
    for (let i = 0; i < sameColumn.length; i++) {
      for (let j = i + 1; j < sameColumn.length; j++) {
        const a = sameColumn[i]
        const b = sameColumn[j]
        const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        expect(overlap).toBeLessThan(Math.min(a.h, b.h) * 0.35)
      }
    }
    const whiteFalsePositives = blocks.filter((block) => classFillStats(raster, block).whiteRatio > 0.5)
    expect(whiteFalsePositives).toHaveLength(0)
  }, 30_000)

  it('matches independently annotated rectangles at IoU 0.85', async () => {
    const raster = await scheduleRaster()
    const grid = detectTimetableGrid(raster)
    expect(grid?.columns).toHaveLength(7)
    const blocks = detectGreenClassBlocks(raster)
    const { matches, unmatched } = matchGroundTruth(blocks)
    const byDay = [0, 1, 2, 3, 4].map((day) => blocks.filter((block) => {
      const col = grid?.columns.reduce((best, candidate) =>
        Math.abs(candidate.center - (block.x + block.w / 2)) < Math.abs(best.center - (block.x + block.w / 2)) ? candidate : best,
      )
      return col?.day === day
    }).length)
    expect(byDay).toEqual([2, 3, 2, 2, 2])
    const failures = matches.filter((match) => match.iou < 0.85)
    expect(
      failures,
      failures.map((match) => `${match.truth.id} iou=${match.iou.toFixed(3)}`).join('\n'),
    ).toEqual([])
    expect(unmatched, 'duplicate or extra detections').toHaveLength(0)
    expect(matches.filter((match) => !match.detected)).toHaveLength(0)
    for (const match of matches) {
      const col = grid?.columns.reduce((best, candidate) =>
        Math.abs(candidate.center - ((match.detected?.x ?? 0) + (match.detected?.w ?? 0) / 2)) <
        Math.abs(best.center - ((match.detected?.x ?? 0) + (match.detected?.w ?? 0) / 2))
          ? candidate
          : best,
      )
      expect(col?.day, match.truth.id).toBe(match.truth.day)
    }
  }, 30_000)
})

const OLIVE: [number, number, number] = [181, 199, 115]
const WHITE: [number, number, number] = [255, 255, 255]
const GREY: [number, number, number] = [186, 186, 186]
const INK: [number, number, number] = [40, 40, 40]

type SynthClass = {
  day: number
  startSlot: number
  slots: number
  textBars?: number
}

function paintSynth(raster: Raster, x: number, y: number, w: number, h: number, rgb: [number, number, number]) {
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(raster.width, Math.ceil(x + w))
  const y1 = Math.min(raster.height, Math.ceil(y + h))
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * raster.width + xx) * 3
      raster.data[i] = rgb[0]
      raster.data[i + 1] = rgb[1]
      raster.data[i + 2] = rgb[2]
    }
  }
}

function makeSyntheticTimetable(opts: {
  classes: SynthClass[]
  marginX?: number
  marginY?: number
  scale?: number
  slots?: number
}) {
  const scale = opts.scale ?? 1
  const marginX = Math.round((opts.marginX ?? 12) * scale)
  const marginY = Math.round((opts.marginY ?? 10) * scale)
  const axisW = Math.round(48 * scale)
  const colW = Math.round(72 * scale)
  const headerH = Math.round(34 * scale)
  const slotH = Math.round(24 * scale)
  const slots = opts.slots ?? 16
  const width = marginX * 2 + axisW + colW * 7
  const height = marginY * 2 + headerH + slotH * slots
  const data = new Uint8Array(width * height * 3)
  const raster: Raster = { data, width, height, channels: 3 }
  paintSynth(raster, 0, 0, width, height, WHITE)

  const gridLeft = marginX
  const gridTop = marginY + headerH
  for (let i = 0; i <= 7; i++) {
    paintSynth(raster, gridLeft + axisW + i * colW, marginY, 1, height - marginY * 2, GREY)
  }
  paintSynth(raster, gridLeft, marginY, 1, height - marginY * 2, GREY)
  paintSynth(raster, gridLeft + axisW, marginY, 1, height - marginY * 2, GREY)
  for (let i = 0; i <= slots; i++) {
    paintSynth(raster, gridLeft, gridTop + i * slotH, axisW + colW * 7, 1, GREY)
  }
  paintSynth(raster, gridLeft, marginY, axisW + colW * 7, 1, GREY)
  paintSynth(raster, gridLeft, marginY + headerH, axisW + colW * 7, 1, GREY)

  const expected: (ClassRect & { day: number })[] = []
  for (const item of opts.classes) {
    const left = gridLeft + axisW + item.day * colW + 2
    const top = gridTop + item.startSlot * slotH + 1
    const w = colW - 4
    const h = item.slots * slotH - 2
    paintSynth(raster, left, top, w, h, OLIVE)
    const bars = item.textBars ?? 4
    for (let b = 0; b < bars; b++) {
      paintSynth(raster, left + 6, top + 4 + b * Math.round(8 * scale), w - 12, Math.max(2, Math.round(3 * scale)), INK)
    }
    expected.push({ day: item.day, x: left, y: top, w, h })
  }

  return { raster, expected }
}

function matchIou(detected: ClassRect[], expected: ClassRect[]) {
  const unused = detected.map((_, i) => i)
  const matches = expected.map((truth) => {
    let bestI = -1
    let best = 0
    for (const index of unused) {
      const iou = rectIou(truth, detected[index])
      if (iou > best) {
        best = iou
        bestI = index
      }
    }
    if (bestI >= 0) unused.splice(unused.indexOf(bestI), 1)
    return { truth, iou: best }
  })
  return { extra: unused.length, missed: matches.filter((match) => match.iou < 0.85).length }
}

function runCase(classes: SynthClass[], extras: { marginX?: number; marginY?: number; scale?: number } = {}) {
  const synth = makeSyntheticTimetable({ classes, ...extras })
  const blocks = detectGreenClassBlocks(synth.raster)
  return { synth, blocks, report: matchIou(blocks, synth.expected) }
}

describe('synthetic Queen’s timetable layouts', () => {
  it('splits two vertically touching one-hour classes', () => {
    const result = runCase([
      { day: 4, startSlot: 5, slots: 2, textBars: 4 },
      { day: 4, startSlot: 7, slots: 2, textBars: 4 },
    ])
    expect(result.blocks.length).toBe(2)
    expect(result.report.missed).toBe(0)
    expect(result.report.extra).toBe(0)
  })

  it('splits three consecutive classes', () => {
    const result = runCase([
      { day: 1, startSlot: 8, slots: 2, textBars: 4 },
      { day: 1, startSlot: 10, slots: 2, textBars: 4 },
      { day: 1, startSlot: 12, slots: 2, textBars: 4 },
    ])
    expect(result.blocks.length).toBe(3)
    expect(result.report.missed).toBe(0)
  })

  it('splits touching classes of different durations', () => {
    const result = runCase([
      { day: 4, startSlot: 5, slots: 2, textBars: 4 },
      { day: 4, startSlot: 7, slots: 3, textBars: 4 },
    ])
    expect(result.blocks.length).toBe(2)
    expect(result.report.missed).toBe(0)
    const heights = result.blocks.map((block) => block.h).sort((a, b) => a - b)
    expect(heights[1]).toBeGreaterThan(heights[0] * 1.1)
  })

  it('keeps a two-hour lab as one class', () => {
    const result = runCase([{ day: 0, startSlot: 1, slots: 4, textBars: 4 }])
    expect(result.blocks.length).toBe(1)
    expect(result.blocks[0].h).toBeGreaterThan(80)
    expect(result.report.missed).toBe(0)
  })

  it('keeps two classes separated by a white gap', () => {
    const result = runCase([
      { day: 2, startSlot: 2, slots: 2, textBars: 4 },
      { day: 2, startSlot: 6, slots: 2, textBars: 4 },
    ])
    expect(result.blocks.length).toBe(2)
    expect(result.report.missed).toBe(0)
  })

  it('does not merge classes across weekday columns', () => {
    const result = runCase([
      { day: 1, startSlot: 4, slots: 2, textBars: 4 },
      { day: 2, startSlot: 4, slots: 2, textBars: 4 },
    ])
    expect(result.blocks.length).toBe(2)
    expect(Math.abs(result.blocks[0].x - result.blocks[1].x)).toBeGreaterThan(40)
    expect(result.report.missed).toBe(0)
  })

  it('handles a dense afternoon', () => {
    const result = runCase([
      { day: 3, startSlot: 6, slots: 2, textBars: 3 },
      { day: 3, startSlot: 8, slots: 2, textBars: 3 },
      { day: 3, startSlot: 11, slots: 2, textBars: 3 },
      { day: 3, startSlot: 13, slots: 2, textBars: 3 },
    ])
    expect(result.blocks.length).toBe(4)
    expect(result.report.missed).toBe(0)
  })

  it('keeps a small class block', () => {
    const result = runCase([{ day: 0, startSlot: 2, slots: 1, textBars: 2 }])
    expect(result.blocks.length).toBe(1)
    expect(result.report.missed).toBe(0)
  })

  it('detects a centred timetable with larger margins', () => {
    const result = runCase(
      [
        { day: 0, startSlot: 2, slots: 2, textBars: 4 },
        { day: 4, startSlot: 8, slots: 2, textBars: 4 },
      ],
      { marginX: 40, marginY: 30 },
    )
    expect(detectTimetableGrid(result.synth.raster)?.columns.length).toBe(7)
    expect(result.blocks.length).toBe(2)
    expect(result.report.missed).toBe(0)
  })

  it('detects a scaled-up timetable', () => {
    const result = runCase(
      [
        { day: 2, startSlot: 3, slots: 2, textBars: 4 },
        { day: 2, startSlot: 5, slots: 2, textBars: 4 },
      ],
      { scale: 2 },
    )
    expect(result.blocks.length).toBe(2)
    expect(result.report.missed).toBe(0)
  })

  it('keeps a green block with no readable course-like ink as one candidate', () => {
    const result = runCase([{ day: 5, startSlot: 4, slots: 2, textBars: 0 }])
    expect(result.blocks.length).toBe(1)
  })
})

async function makePdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const lines of pages) {
    const page = doc.addPage([612, 792])
    lines.forEach((line, i) => {
      page.drawText(line, { x: 72, y: 720 - i * 18, size: 12, font })
    })
  }
  return doc.save()
}

describe('OCR helpers', () => {
  it('converts word boxes into parser items and divides by render scale', () => {
    const items = ocrWordsToItems(
      [
        { text: 'CISC', x0: 219, y0: 198, x1: 270, y1: 216 },
        { text: 'B:30AM', x0: 258, y0: 264, x1: 340, y1: 282 },
      ],
      1,
      3,
    )
    expect(items[0]).toMatchObject({ text: 'CISC', page: 1, x: 73 })
    expect(items[1].text).toBe('8:30AM')
    expect(items[1].x).toBeCloseTo(86, 0)
  })

  it('flags pages without usable timetable text', () => {
    expect(pageNeedsOcr([])).toBe(true)
    expect(pageNeedsOcr([{ text: 'CISC 320 Tutorial Monday 09:30', page: 1, x: 10, y: 10 }])).toBe(false)
  })
})

describe('extractPdfBytes', () => {
  it('reads text, positions, and multiple pages', async () => {
    const data = await makePdf([['Hello timetable'], ['CISC 320 page two']])
    const extracted = await extractPdfBytes(data)
    expect(extracted.pageCount).toBe(2)
    const texts = extracted.items.map((item) => item.text).join(' ')
    expect(texts).toMatch(/Hello/)
    expect(texts).toMatch(/CISC/)
    expect(extracted.items.some((item) => item.page === 2)).toBe(true)
    expect(extracted.items[0].x).toBeTypeOf('number')
    expect(extracted.items[0].y).toBeTypeOf('number')
    expect(extracted.usedOcr).toBe(false)
  })

  it('rejects damaged files', async () => {
    await expect(extractPdfBytes(new TextEncoder().encode('not a pdf'))).rejects.toBeInstanceOf(PdfExtractError)
  })

  it('identifies a blank page as unreadable after OCR finds nothing', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    const data = await doc.save()
    await expect(extractPdfBytes(data)).rejects.toMatchObject({ code: 'no-text' })
  })

  it('rejects non-PDF files and oversized uploads before opening them', async () => {
    await expect(extractPdfFile(new File(['notes'], 'notes.txt', { type: 'text/plain' }))).rejects.toMatchObject({
      code: 'not-pdf',
    })
    const huge = new File(['%PDF'], 'big.pdf', { type: 'application/pdf' })
    Object.defineProperty(huge, 'size', { value: 11 * 1024 * 1024 })
    await expect(extractPdfFile(huge)).rejects.toMatchObject({ code: 'too-large' })
  })

  it.skipIf(!existsSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'schedule.pdf')))(
    'OCRs the image-only Queen’s timetable fixture',
    async () => {
    localStorage.clear()
    const path = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'schedule.pdf')
    const data = await readFile(path)
    const extracted = await extractPdfBytes(data)
    expect(extracted.usedOcr).toBe(true)
    expect(extracted.debug?.classBlocks).toBe(11)
    expect(extracted.entries.length).toBeGreaterThan(0)
    expect(extracted.entries.some((entry) => entry.days[0] === 0)).toBe(true)
    expect(localStorage.length).toBe(0)
    const parsed = extracted.entries.length ? extracted.entries : parseTimetable(extracted.items).entries
    const hasCourse = parsed.some((entry) => entry.courseCode)
    const hasLocation = parsed.some((entry) => entry.location)
    expect(hasCourse || hasLocation || parsed.some((entry) => entry.startTime)).toBe(true)
    const whiteCells = extracted.entries.filter(
      (entry) => !entry.courseCode && !entry.location && entry.title === 'Unknown class' && !entry.startTime,
    )
    expect(whiteCells).toHaveLength(0)
    expect(extracted.entries).toHaveLength(11)
    expect(extracted.debug?.incomplete).toBeGreaterThanOrEqual(0)
  }, 180_000)

  it('does not fetch a remote worker or upload the PDF', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const data = await makePdf([['CISC 320 Tutorial']])
    await extractPdfBytes(data)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchActivities', () => {
  it('keeps ordinary searches as minutes and location only', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ activities: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await fetchActivities(45, 'stauffer-library')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/activities?minutes=45&location=stauffer-library')
  })

  it('adds schedule-window parameters without uploading a PDF', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ activities: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await fetchActivities(90, 'ellis-hall', undefined, {
      at: '2026-11-16T10:00',
      destinationId: 'kingston-hall',
      until: '13:00',
      buffer: 5,
    })
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/api/activities?')
    expect(url).toContain('minutes=90')
    expect(url).toContain('location=ellis-hall')
    expect(url).toContain('destination=kingston-hall')
    expect(url).toContain('until=13%3A00')
    expect(url).toContain('buffer=5')
    expect(url).not.toMatch(/pdf/i)
  })
})

describe('fetchLocations', () => {
  it('reads landmark ids, names, and optional notes from GET /api/locations', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        locations: [
          { id: 'ellis-hall', name: 'Ellis Hall' },
          { id: 'dunning-hall', name: 'Dunning Hall', notes: 'provisional coordinates' },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const places = await fetchLocations()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/locations')
    expect(places.map((place) => place.id)).toEqual(['ellis-hall', 'dunning-hall'])
    expect(places[1].notes).toMatch(/provisional/)
  })
})