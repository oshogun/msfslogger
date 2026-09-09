import { describe, it, expect, beforeEach } from 'vitest';
import { parseCSV, parseCSVLine, setAirports, findNearestAirport } from '../src/airports';

const HEADER = '"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","gps_code","icao_code","iata_code","local_code","home_link","wikipedia_link","keywords"';
const row = (o: Record<number, string>) => {
  const f = new Array(19).fill('');
  for (const [k, v] of Object.entries(o)) f[Number(k)] = v;
  return f.join(',');
};

describe('parseCSVLine', () => {
  it('splits plain fields', () => expect(parseCSVLine('a,b,c')).toEqual(['a', 'b', 'c']));
  it('keeps a quoted comma in one field and strips the quotes', () =>
    expect(parseCSVLine('1,"Foo, Bar",3')).toEqual(['1', 'Foo, Bar', '3']));
  it('emits an empty trailing field', () => expect(parseCSVLine('a,b,')).toEqual(['a', 'b', '']));
  it('does not un-double a doubled quote (known limitation)', () =>
    expect(parseCSVLine('1,"He said ""hi""",3')).toEqual(['1', 'He said hi', '3']));
});

describe('parseCSV', () => {
  it('accepts large/medium/small and rejects everything else', () => {
    const csv = [HEADER,
      row({1:'KSBA',2:'medium_airport',3:'Santa Barbara Municipal Airport',4:'34.426201',5:'-119.839996',12:'KSBA'}),
      row({1:'KSFO',2:'large_airport',3:'San Francisco International Airport',4:'37.618999',5:'-122.375',12:'KSFO'}),
      row({1:'00AA',2:'small_airport',3:'Aero B Ranch Airport',4:'38.704022',5:'-101.473911',12:'00AA'}),
      row({1:'KJRA',2:'heliport',3:'West 30th St Heliport',4:'40.7545',5:'-74.0071',12:'KJRA'}),
      row({1:'XXXX',2:'closed',3:'Closed Field',4:'1',5:'1',12:'XXXX'}),
      row({1:'S60',2:'seaplane_base',3:'Kenmore Air Harbor',4:'47.7545',5:'-122.2596',12:'S60'}),
    ].join('\n');
    expect(parseCSV(csv).map(a => a.icao)).toEqual(['KSBA', 'KSFO', '00AA']);
  });

  it('prefers gps_code (col 12) over ident (col 1), uppercases and trims', () => {
    const csv = [HEADER, row({1:'ident-x',2:'small_airport',3:'N',4:'1',5:'2',12:' ksba '})].join('\n');
    expect(parseCSV(csv)[0].icao).toBe('KSBA');
  });

  it('falls back to ident when gps_code is empty', () => {
    const csv = [HEADER, row({1:'kmry',2:'medium_airport',3:'N',4:'1',5:'2'})].join('\n');
    expect(parseCSV(csv)[0].icao).toBe('KMRY');
  });

  it('drops idents that are not exactly four A-Z0-9', () => {
    const csv = [HEADER,
      row({1:'KSB',2:'small_airport',3:'N',4:'1',5:'2'}),
      row({1:'KSBAX',2:'small_airport',3:'N',4:'1',5:'2'}),
      row({1:'K-BA',2:'small_airport',3:'N',4:'1',5:'2'}),
    ].join('\n');
    expect(parseCSV(csv)).toEqual([]);
  });

  it('drops rows with unparseable coordinates', () => {
    const csv = [HEADER, row({1:'KSBA',2:'small_airport',3:'N',4:'',5:'-119.8'}),
                          row({1:'KMRY',2:'small_airport',3:'N',4:'36.5',5:'nope'})].join('\n');
    expect(parseCSV(csv)).toEqual([]);
  });

  it('falls back to the icao when the name column is empty', () => {
    const csv = [HEADER, row({1:'KSBA',2:'small_airport',3:'',4:'1',5:'2'})].join('\n');
    expect(parseCSV(csv)[0].name).toBe('KSBA');
  });

  it('skips the header row and blank lines', () => {
    const csv = [HEADER, '', row({1:'KSBA',2:'small_airport',3:'N',4:'1',5:'2'}), '   ', ''].join('\n');
    expect(parseCSV(csv)).toHaveLength(1);
  });

  it('handles CRLF because each line is trimmed', () => {
    const csv = [HEADER, row({1:'KSBA',2:'small_airport',3:'N',4:'1',5:'2'})].join('\r\n');
    expect(parseCSV(csv)).toHaveLength(1);
  });
});

describe('findNearestAirport', () => {
  const KSBA = { icao: 'KSBA', name: 'Santa Barbara Municipal Airport', lat: 34.426201, lon: -119.839996 };
  const KMRY = { icao: 'KMRY', name: 'Monterey Regional Airport', lat: 36.587, lon: -121.8429 };

  beforeEach(() => setAirports([]));

  it('returns null when the table is empty', () => {
    expect(findNearestAirport(34.4262, -119.84)).toBeNull();
  });

  it('returns the nearest inside the default 10 nm radius', () => {
    setAirports([KSBA, KMRY]);
    expect(findNearestAirport(34.4262, -119.84)).toEqual({ icao: 'KSBA', name: KSBA.name });
  });

  it('returns null when the nearest is outside the radius', () => {
    setAirports([KSBA]);
    expect(findNearestAirport(34.4262 + 20 / 60, -119.839996)).toBeNull();
  });

  it('honours an explicit maxNm', () => {
    setAirports([KSBA]);
    expect(findNearestAirport(34.4262 + 20 / 60, -119.839996, 25)?.icao).toBe('KSBA');
  });

  it('needs the codebase nm-per-degree, not 60, to hit a radius edge', () => {
    const DEG_PER_NM = 180 / (Math.PI * 3440.065); // 1 nm = 0.016655435148 deg
    setAirports([{ ...KSBA, lat: 0, lon: 0 }]);
    expect(findNearestAirport(10 * DEG_PER_NM * 0.999, 0, 10)?.icao).toBe('KSBA');
    expect(findNearestAirport(10 * DEG_PER_NM * 1.001, 0, 10)).toBeNull();
    expect(findNearestAirport(10 / 60, 0, 10)).toBeNull(); // 10 arc-minutes is 10.0067 nm here
  });
});
