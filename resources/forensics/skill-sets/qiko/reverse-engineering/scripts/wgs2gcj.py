#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
wgs2gcj.py — WGS-84 -> GCJ-02 coordinate conversion (China offset).

Usage:
    python wgs2gcj.py conv <lat> <lon>           # one point
    python wgs2gcj.py batch <in.json> <out.json> # [{lat,lon,...}, ...]
    python wgs2gcj.py js                          # print JS implementation
"""
import sys
import json
import math

PI = 3.1415926535897932384626
A = 6378245.0
EE = 0.00669342162296594323

def out_of_china(lng, lat):
    return lng < 72.004 or lng > 137.8347 or lat < 0.8293 or lat > 55.8271

def _transform_lat(x, y):
    r = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 2*math.sqrt(abs(x))
    r += (20*math.sin(6*x*PI) + 20*math.sin(2*x*PI)) * 2/3
    r += (20*math.sin(y*PI) + 40*math.sin(y/3*PI)) * 2/3
    r += (160*math.sin(y/12*PI) + 320*math.sin(y*PI/30)) * 2/3
    return r

def _transform_lng(x, y):
    r = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*math.sqrt(abs(x))
    r += (20*math.sin(6*x*PI) + 20*math.sin(2*x*PI)) * 2/3
    r += (20*math.sin(x*PI) + 40*math.sin(x/3*PI)) * 2/3
    r += (150*math.sin(x/12*PI) + 300*math.sin(x/30*PI)) * 2/3
    return r

def wgs2gcj(lng, lat):
    """Returns (gcj_lng, gcj_lat). Input/output in degrees."""
    if out_of_china(lng, lat):
        return lng, lat
    d_lat = _transform_lat(lng - 105, lat - 35)
    d_lng = _transform_lng(lng - 105, lat - 35)
    rad_lat = lat * PI / 180
    magic = math.sin(rad_lat)
    magic = 1 - EE * magic * magic
    sqrt_magic = math.sqrt(magic)
    d_lat = (d_lat * 180) / ((A * (1 - EE)) / (magic * sqrt_magic) * PI)
    d_lng = (d_lng * 180) / (A / sqrt_magic * math.cos(rad_lat) * PI)
    return lng + d_lng, lat + d_lat

def heading(lat1, lon1, lat2, lon2):
    """Bearing from point 1 to point 2, in degrees 0-360."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_lambda = math.radians(lon2 - lon1)
    y = math.sin(d_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(d_lambda)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def cmd_conv(lat, lon):
    glng, glat = wgs2gcj(float(lon), float(lat))
    print(f"WGS-84:  lat={lat}, lon={lon}")
    print(f"GCJ-02:  lat={glat:.6f}, lon={glng:.6f}")
    print(f"Offset:  dlat={glat-float(lat):.6f}, dlng={glng-float(lon):.6f}")

def cmd_batch(in_path, out_path):
    with open(in_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    for item in data:
        if 'lat' in item and 'lon' in item:
            glng, glat = wgs2gcj(item['lon'], item['lat'])
            item['gcj_lat'] = glat
            item['gcj_lon'] = glng
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Converted {len(data)} points -> {out_path}")

def cmd_js():
    print("""// WGS-84 -> GCJ-02 in JavaScript (paste into HTML)
const PI = 3.1415926535897932384626;
const A = 6378245.0;
const EE = 0.00669342162296594323;
function outOfChina(lng, lat){ return lng<72.004||lng>137.8347||lat<0.8293||lat>55.8271; }
function tLat(x,y){ let r=-100+2*x+3*y+0.2*y*y+0.1*x*y+2*Math.sqrt(Math.abs(x)); r+=(20*Math.sin(6*x*PI)+20*Math.sin(2*x*PI))*2/3; r+=(20*Math.sin(y*PI)+40*Math.sin(y/3*PI))*2/3; r+=(160*Math.sin(y/12*PI)+320*Math.sin(y*PI/30))*2/3; return r; }
function tLng(x,y){ let r=300+x+2*y+0.1*x*x+0.1*x*y+0.1*Math.sqrt(Math.abs(x)); r+=(20*Math.sin(6*x*PI)+20*Math.sin(2*x*PI))*2/3; r+=(20*Math.sin(x*PI)+40*Math.sin(x/3*PI))*2/3; r+=(150*Math.sin(x/12*PI)+300*Math.sin(x/30*PI))*2/3; return r; }
function wgs2gcj(lng, lat){
  if(outOfChina(lng,lat)) return [lng,lat];
  let dLat=tLat(lng-105,lat-35), dLng=tLng(lng-105,lat-35);
  const rLat=lat*PI/180; let m=Math.sin(rLat); m=1-EE*m*m; const sq=Math.sqrt(m);
  dLat=(dLat*180)/((A*(1-EE))/(m*sq)*PI);
  dLng=(dLng*180)/(A/sq*Math.cos(rLat)*PI);
  return [lng+dLng, lat+dLat];
}
// usage: const [gcjLng, gcjLat] = wgs2gcj(wgsLng, wgsLat);
""")

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == 'conv' and len(sys.argv) == 4:
        cmd_conv(sys.argv[2], sys.argv[3])
    elif cmd == 'batch' and len(sys.argv) == 4:
        cmd_batch(sys.argv[2], sys.argv[3])
    elif cmd == 'js' and len(sys.argv) == 2:
        cmd_js()
    else:
        print(__doc__)
        sys.exit(1)

if __name__ == '__main__':
    main()
