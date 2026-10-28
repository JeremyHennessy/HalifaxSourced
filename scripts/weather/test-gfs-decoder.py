#!/usr/bin/env python3
"""Synthetic local GRIB only: proves decoder behavior, not real provider admission."""
import importlib.util
import tempfile
from pathlib import Path
from eccodes import codes_grib_new_from_samples, codes_set, codes_set_values, codes_write, codes_release
spec = importlib.util.spec_from_file_location('decoder', Path(__file__).with_name('decode-gfs-temperature.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
points = [{'id': 'halifax_peninsula', 'latitude': 44.6488, 'longitude': -63.5752}]
with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / 'fixture.grib2'
    def create(**patch):
        h = codes_grib_new_from_samples('regular_ll_sfc_grib2')
        values = dict(centre=7, typeOfLevel='heightAboveGround', level=2, shortName='2t', Ni=3, Nj=3,
                      latitudeOfFirstGridPointInDegrees=44.75, latitudeOfLastGridPointInDegrees=44.25,
                      longitudeOfFirstGridPointInDegrees=296.25, longitudeOfLastGridPointInDegrees=296.75,
                      iDirectionIncrementInDegrees=.25, jDirectionIncrementInDegrees=.25,
                      dataDate=20261028, dataTime=0, stepUnits=1, forecastTime=6, generatingProcessIdentifier=81)
        for k, v in values.items(): codes_set(h, k, v)
        for k, v in patch.items(): codes_set(h, k, v)
        codes_set_values(h, [283.15] * 9)
        with open(path, 'wb') as f: codes_write(h, f)
        codes_release(h)
    create()
    out = m.decode(path, points)
    assert out['modelReferenceTime'] == '2026-10-28T00:00:00Z' and out['validAt'] == '2026-10-28T06:00:00Z'
    assert abs(out['points'][0]['valueC'] - 10) < .001
    assert out['projection'] == 'nearest_grid_point'
    for patch in [{'centre': 98}, {'forecastTime': 0}, {'level': 10}]:
        create(**patch)
        try: m.decode(path, points)
        except AssertionError: pass
        else: raise AssertionError('invalid field accepted: ' + str(patch))
    create()
    path.write_bytes(path.read_bytes() * 2)
    try: m.decode(path, points)
    except AssertionError: pass
    else: raise AssertionError('multiple fields accepted')
print('5 synthetic offline decoder cases passed; no source requests.')
