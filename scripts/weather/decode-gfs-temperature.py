#!/usr/bin/env python3
"""Offline-only, bounded single-field GFS GRIB2 decoder. No downloads or source activation.
Requires the separately reviewed ecCodes Python package; no network in this module.
A decoded grid point is model support, never a co-located observation.
"""
import hashlib
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from eccodes import (codes_grib_new_from_file, codes_get, codes_get_values,
                     codes_grib_find_nearest, codes_release)


def decode(path, points, provider="gfs"):
    assert provider in ("gfs", "ecmwf_ifs")
    byte_limit = 1024 * 1024 if provider == 'gfs' else 4 * 1024 * 1024
    with open(path, 'rb') as bounded_input:
        body = bounded_input.read(byte_limit + 1)
    assert 0 < len(body) <= byte_limit, 'GRIB byte budget'
    assert body[:4] == b'GRIB' and body[-4:] == b'7777', 'complete GRIB required'
    assert 0 < len(points) <= 6, 'bounded reviewed points required'
    with open(path, 'rb') as stream:
        handle = codes_grib_new_from_file(stream)
        assert handle is not None, 'missing GRIB message'
        try:
            assert codes_get(handle, 'edition') == 2
            centre = 7 if provider == 'gfs' else 98
            assert codes_get(handle, 'centre', int) == centre, 'unexpected forecast centre'
            assert codes_get(handle, 'typeOfLevel') == 'heightAboveGround'
            assert codes_get(handle, 'level') == 2
            assert codes_get(handle, 'shortName') == '2t'
            assert codes_get(handle, 'units') == 'K'
            assert codes_get(handle, 'stepType') == 'instant'
            assert codes_get(handle, 'stepUnits', int) == 1, 'hour step required'
            step = codes_get(handle, 'forecastTime', int)
            assert 0 < step <= 384, 'forecast not analysis/current estimate'
            assert codes_get(handle, 'gridType') == 'regular_ll', 'reviewed latitude-longitude grid required'
            count = codes_get(handle, 'numberOfDataPoints')
            assert 0 < count <= (10000 if provider == 'gfs' else 1100000), 'grid budget'
            if provider == 'ecmwf_ifs':
                assert codes_get(handle, 'Ni') == 1440 and codes_get(handle, 'Nj') == 721, 'expected global0.25grid'
                assert codes_get(handle, 'latitudeOfFirstGridPointInDegrees') == 90
                assert codes_get(handle, 'latitudeOfLastGridPointInDegrees') == -90
                assert codes_get(handle, 'iDirectionIncrementInDegrees') == .25
                assert codes_get(handle, 'jDirectionIncrementInDegrees') == .25
            assert codes_get(handle, 'numberOfMissing') == 0, 'incomplete field'
            reference = datetime.strptime(str(codes_get(handle, 'dataDate')) + f"{codes_get(handle, 'dataTime'):04d}", '%Y%m%d%H%M').replace(tzinfo=timezone.utc)
            valid = datetime.strptime(str(codes_get(handle, 'validityDate')) + f"{codes_get(handle, 'validityTime'):04d}", '%Y%m%d%H%M').replace(tzinfo=timezone.utc)
            assert valid == reference + timedelta(hours=step)
            assert all(math.isfinite(float(v)) and 173.15 <= v <= 343.15 for v in codes_get_values(handle)), 'physical temperature bounds'
            samples = []
            for point in points:
                assert 44.5 <= point['latitude'] <= 44.9 and -63.8 <= point['longitude'] <= -63.4, 'outside Halifax bounds'
                nearest = codes_grib_find_nearest(handle, point['latitude'], point['longitude'], is_lsm=False, npoints=1)[0]
                longitude = (nearest['lon'] + 180) % 360 - 180
                assert nearest['distance'] <= 30, 'grid point too distant'
                assert 44.25 <= nearest['lat'] <= 45.0 and -64 <= longitude <= -63.25, 'unexpected regional grid'
                samples.append({'locationId': point['id'], 'latitude': point['latitude'], 'longitude': point['longitude'], 'valueC': nearest['value'] - 273.15,
                                'gridLatitude': nearest['lat'], 'gridLongitude': longitude, 'distanceKm': nearest['distance'], 'gridIndex': nearest['index']})
            result = {'version': 1, 'kind': 'decoded_' + provider + '_temperature_points', 'sourceBodySha256': hashlib.sha256(body).hexdigest(), 'bodyBytes': len(body),
                      'modelReferenceTime': reference.isoformat().replace('+00:00', 'Z'), 'validAt': valid.isoformat().replace('+00:00', 'Z'), 'leadHours': step,
                      'centre': centre, 'generatingProcessIdentifier': codes_get(handle, 'generatingProcessIdentifier'), 'gridType': codes_get(handle, 'gridType'),
                      'numberOfDataPoints': codes_get(handle, 'numberOfDataPoints'), 'variable': 'temperature_2m', 'sourceUnit': 'K', 'unit': 'C', 'projection': 'nearest_grid_point', 'points': samples}
        finally:
            codes_release(handle)
        extra = codes_grib_new_from_file(stream)
        if extra is not None:
            codes_release(extra)
            raise AssertionError('multiple GRIB messages not accepted')
    return result


if __name__ == '__main__':
    assert len(sys.argv) in (3, 4), 'usage: decode-gfs-temperature.py body.grib2 reviewed-points.json [gfs|ecmwf_ifs]'
    points = json.loads(Path(sys.argv[2]).read_text())
    print(json.dumps(decode(sys.argv[1], points, sys.argv[3] if len(sys.argv) == 4 else 'gfs'), allow_nan=False, sort_keys=True))
