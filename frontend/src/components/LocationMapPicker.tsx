import L from "leaflet";
import { useEffect, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { EmployeeLocationMap } from "../types";

interface LocationMapPickerProps {
  provinceName: string;
  departmentName: string;
  localityName: string;
  addressStreet: string;
  addressNumber: string;
  initialCenter?: { lat: number; lng: number; zoom?: number };
  value: EmployeeLocationMap;
  onChange: (value: EmployeeLocationMap) => void;
  readOnly?: boolean;
}

const markerIcon = L.divIcon({
  className: "custom-leaflet-marker",
  html: "<span></span>",
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

function labelFor(props: Pick<LocationMapPickerProps, "provinceName" | "departmentName" | "localityName" | "addressStreet" | "addressNumber">) {
  return [props.addressStreet, props.addressNumber, props.localityName, props.departmentName, props.provinceName].filter(Boolean).join(", ");
}

function coordinatesFromGoogleMapsUrl(url: string) {
  const decoded = decodeURIComponent(url.trim());
  const exact = decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (exact) return { lat: Number(exact[1]), lng: Number(exact[2]) };
  const viewport = decoded.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),/);
  if (viewport) return { lat: Number(viewport[1]), lng: Number(viewport[2]) };
  const query = decoded.match(/[?&]query=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (query) return { lat: Number(query[1]), lng: Number(query[2]) };
  return null;
}

function Recenter({ lat, lng, zoom }: { lat: number; lng: number; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], zoom, { animate: true });
  }, [lat, lng, map, zoom]);
  return null;
}

function ClickHandler({ disabled, onPick }: { disabled?: boolean; onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event) {
      if (!disabled) onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

export function LocationMapPicker(props: LocationMapPickerProps) {
  const [mapsUrl, setMapsUrl] = useState("");
  const [mapsUrlError, setMapsUrlError] = useState("");
  const selectedCenter = props.value.lat !== null && props.value.lng !== null ? { lat: props.value.lat, lng: props.value.lng } : undefined;
  const hasLocality = Boolean(props.provinceName && props.departmentName && props.localityName && (props.initialCenter || selectedCenter));
  const mapCenter = selectedCenter || props.initialCenter;
  const zoom = selectedCenter ? 16 : props.initialCenter?.zoom || 14;
  const description = labelFor(props);

  const setPoint = (lat: number, lng: number, label = description) => {
    props.onChange({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), source: "MANUAL", label });
  };

  const applyGoogleMapsUrl = () => {
    const coordinates = coordinatesFromGoogleMapsUrl(mapsUrl);
    if (!coordinates) return setMapsUrlError("No pude leer coordenadas de esa URL. Pegá el link completo de Google Maps.");
    setMapsUrlError("");
    setPoint(coordinates.lat, coordinates.lng, `${description} · Google Maps`);
  };

  if (!hasLocality || !mapCenter) {
    return <div className="location-map-card empty-map">Seleccioná provincia, departamento y localidad para visualizar el mapa.</div>;
  }

  return <div className="location-map-card">
    <div className="map-heading">
      <div>
        <b>Ubicación seleccionada: {props.localityName}, {props.departmentName}, {props.provinceName}</b>
        <span>{props.value.label ? `Marcador guardado: ${props.value.label}` : "Hacé clic en el mapa para marcar el domicilio aproximado."}</span>
      </div>
    </div>
    {!props.readOnly && <div className="google-map-url-panel">
      <label>URL de Google Maps
        <input value={mapsUrl} placeholder="Pegá el link de Google Maps para tomar sus coordenadas" onChange={(event) => { setMapsUrl(event.target.value); setMapsUrlError(""); }} />
      </label>
      <button type="button" className="button subtle" disabled={!mapsUrl.trim()} onClick={applyGoogleMapsUrl}>Usar coordenadas del link</button>
      {mapsUrlError && <small>{mapsUrlError}</small>}
    </div>}
    <MapContainer center={[mapCenter.lat, mapCenter.lng]} zoom={zoom} scrollWheelZoom className="leaflet-map">
      <Recenter lat={mapCenter.lat} lng={mapCenter.lng} zoom={zoom} />
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <ClickHandler disabled={props.readOnly} onPick={setPoint} />
      {selectedCenter && <Marker
        position={[selectedCenter.lat, selectedCenter.lng]}
        icon={markerIcon}
        draggable={!props.readOnly}
        eventHandlers={{ dragend: (event) => {
          const next = event.target.getLatLng();
          setPoint(next.lat, next.lng);
        } }}
      />}
    </MapContainer>
    <div className="map-coordinates">
      {selectedCenter ? <span>Coordenadas: {selectedCenter.lat.toFixed(6)}, {selectedCenter.lng.toFixed(6)} · Origen: {props.value.source}</span> : <span>Sin ubicación marcada.</span>}
    </div>
  </div>;
}
