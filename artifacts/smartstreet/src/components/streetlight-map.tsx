'use client';

import { useMemo } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';

type Streetlight = {
  id: string;
  light_code: string;
  latitude: number;
  longitude: number;
  location: string;
  zone: string;
  status: string;
};

const hyderabad: [number, number] = [17.385, 78.4867];

export default function StreetlightMap({ lights }: { lights: Streetlight[] }) {
  const validLights = lights.filter((light) => Number.isFinite(Number(light.latitude)) && Number.isFinite(Number(light.longitude)));
  const center = useMemo<[number, number]>(() => validLights.length
    ? [validLights.reduce((sum, item) => sum + Number(item.latitude), 0) / validLights.length, validLights.reduce((sum, item) => sum + Number(item.longitude), 0) / validLights.length]
    : hyderabad, [lights]);

  return <div className="map-frame" aria-label={`OpenStreetMap showing ${validLights.length} streetlights`}>
    <MapContainer center={center} zoom={validLights.length > 1 ? 12 : 14} scrollWheelZoom className="street-map">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {validLights.map((light) => {
        const state = light.status.toLowerCase();
        const markerState = state === 'working' ? 'is-ok'
          : state === 'maintenance' ? 'is-maintenance'
            : state === 'inactive' ? 'is-inactive' : 'is-alert';
        const icon = L.divIcon({ className: `street-marker ${markerState}`, html: '<span></span>', iconSize: [28, 34], iconAnchor: [14, 30], popupAnchor: [0, -28] });
        return <Marker key={light.id} position={[Number(light.latitude), Number(light.longitude)]} icon={icon}>
          <Popup><div className="map-popup"><strong>{light.light_code}</strong><span>{light.location}</span><small>{light.zone} · {state.replaceAll('_', ' ')}</small></div></Popup>
        </Marker>;
      })}
    </MapContainer>
    <span className="map-label">HYDERABAD · STREETLIGHT NETWORK</span>
    <div className="map-legend"><span className="legend-item"><i className="legend-dot" />Needs attention</span><span className="legend-item"><i className="legend-dot ok" />Working</span></div>
    <span className="map-count">{validLights.length} LIGHTS MAPPED</span>
  </div>;
}
