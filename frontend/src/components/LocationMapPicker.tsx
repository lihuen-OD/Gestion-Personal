import L, { type LatLngExpression } from "leaflet";
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

function Recenter({ center, zoom }: { center: LatLngExpression; zoom: number }) {
  const map = useMap();
  map.setView(center, zoom);
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
  const hasLocality = Boolean(props.provinceName && props.departmentName && props.localityName && props.initialCenter);
  const selectedCenter = props.value.lat !== null && props.value.lng !== null ? { lat: props.value.lat, lng: props.value.lng } : undefined;
  const mapCenter = selectedCenter || props.initialCenter;
  const zoom = selectedCenter ? 16 : props.initialCenter?.zoom || 14;
  const description = labelFor(props);

  const setPoint = (lat: number, lng: number) => {
    props.onChange({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), source: "MANUAL", label: description });
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
      <div className="map-toolbar">
        <button type="button" className="button subtle" disabled={props.readOnly} onClick={() => props.initialCenter && props.onChange({ lat: props.initialCenter.lat, lng: props.initialCenter.lng, source: "MOCK", label: description })}>Usar centro de la localidad</button>
        <button type="button" className="button subtle" disabled={props.readOnly} onClick={() => props.onChange({ lat: null, lng: null, source: "MOCK", label: "" })}>Limpiar ubicación</button>
      </div>
    </div>
    <MapContainer center={[mapCenter.lat, mapCenter.lng]} zoom={zoom} scrollWheelZoom className="leaflet-map">
      <Recenter center={[mapCenter.lat, mapCenter.lng]} zoom={zoom} />
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
