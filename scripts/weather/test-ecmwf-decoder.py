#!/usr/bin/env python3
"""Synthetic global field validates bounded extraction, never source/accuracy evidence."""
import importlib.util
import tempfile
from pathlib import Path
import numpy as np
from eccodes import codes_grib_new_from_samples, codes_set, codes_set_values, codes_write, codes_release
spec = importlib.util.spec_from_file_location('decoder', Path(__file__).with_name('decode-gfs-temperature.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
points = [{'id': 'halifax_peninsula', 'latitude': 44.6488, 'longitude': -63.5752}]
with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / 'fixture.grib2'
    h = codes_grib_new_from_samples('regular_ll_sfc_grib2')
    for key, value in dict(centre=98,typeOfLevel='heightAboveGround',level=2,shortName='2t',Ni=1440,Nj=721,latitudeOfFirstGridPointInDegrees=90,latitudeOfLastGridPointInDegrees=-90,longitudeOfFirstGridPointInDegrees=0,longitudeOfLastGridPointInDegrees=359.75,iDirectionIncrementInDegrees=.25,jDirectionIncrementInDegrees=.25,dataDate=20261028,dataTime=0,stepUnits=1,forecastTime=6,generatingProcessIdentifier=1).items(): codes_set(h,key,value)
    codes_set_values(h,np.full(1440*721,283.15))
    with open(path,'wb') as stream: codes_write(h,stream)
    codes_release(h)
    out=m.decode(path,points,'ecmwf_ifs')
    assert out['kind']=='decoded_ecmwf_ifs_temperature_points' and out['centre']==98
    assert out['numberOfDataPoints']==1038240 and abs(out['points'][0]['valueC']-10)<.001
    try: m.decode(path,points,'gfs')
    except AssertionError: pass
    else: raise AssertionError('ECMWF field accepted as GFS')
print('2 synthetic ECMWF decoder cases passed; one-point extraction from generated global field, no source requests.')
