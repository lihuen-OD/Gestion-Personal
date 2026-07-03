import { useCallback, useEffect, useMemo, useState } from "react";
import { locationService, type GeoOption } from "../services/locationService";
import type { EmployeeAddress, EmployeeLocationMap } from "../types";

const emptyMap: EmployeeLocationMap = { lat: null, lng: null, source: "MOCK", label: "" };
const addressNotFoundMessage = "No se pudo ubicar la dirección exacta. Se muestra la localidad para que ajuste el marcador manualmente.";
const geoServiceErrorMessage = "No se pudo consultar el servicio geográfico. Intente nuevamente o ajuste el marcador manualmente.";

interface GeoAddressFieldsProps {
  value: EmployeeAddress;
  onChange: (value: EmployeeAddress) => void;
  includeStreet?: boolean;
  showGeoActions?: boolean;
  readOnly?: boolean;
}

function labelFor(address: EmployeeAddress) {
  return [address.calle, address.numero, address.localidadNombre, address.departamentoNombre, address.provinciaNombre].filter(Boolean).join(", ");
}

function googleMapsUrl(address: EmployeeAddress) {
  const query = [address.calle, address.numero, address.localidadNombre, address.departamentoNombre, address.provinciaNombre, "Argentina"].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function GeoSelect({ label, value, options, disabled, loading, emptyText, onSelect, onQuery }: { label: string; value: string; options: GeoOption[]; disabled?: boolean; loading?: boolean; emptyText?: string; onSelect: (option: GeoOption) => void; onQuery?: (query: string) => void }) {
  const listId = useMemo(() => `${label.replace(/\s+/g, "-").toLowerCase()}-${options.length}`, [label, options.length]);
  const [query, setQuery] = useState(value);
  useEffect(() => setQuery(value), [value]);

  return <label>{label}
    <input disabled={disabled} value={query} list={listId} placeholder={disabled ? "Seleccioná el campo anterior" : loading ? "Cargando..." : "Buscar o seleccionar"} onChange={(event) => {
      const next = event.target.value;
      setQuery(next);
      onQuery?.(next);
      const selected = options.find((option) => option.name === next);
      if (selected) onSelect(selected);
    }} />
    <datalist id={listId}>{options.map((option) => <option key={option.id} value={option.name} />)}</datalist>
    {!disabled && !loading && emptyText && !options.length && <small>{emptyText}</small>}
  </label>;
}

export function GeoAddressFields({ value, onChange, includeStreet = true, showGeoActions = true, readOnly = false }: GeoAddressFieldsProps) {
  const [provinces, setProvinces] = useState<GeoOption[]>(locationService.getProvinces().map((item) => ({ id: item.id, name: item.name })));
  const [departments, setDepartments] = useState<GeoOption[]>([]);
  const [localities, setLocalities] = useState<GeoOption[]>([]);
  const [streets, setStreets] = useState<GeoOption[]>([]);
  const [selectedStreet, setSelectedStreet] = useState<GeoOption | undefined>();
  const [streetQuery, setStreetQuery] = useState("");
  const [lastGeocoded, setLastGeocoded] = useState("");
  const [isLoadingProvinces, setIsLoadingProvinces] = useState(false);
  const [isLoadingDepartments, setIsLoadingDepartments] = useState(false);
  const [isLoadingLocalities, setIsLoadingLocalities] = useState(false);
  const [isLoadingStreets, setIsLoadingStreets] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geoStatus, setGeoStatus] = useState("");
  const [geoError, setGeoError] = useState("");

  const selectedProvinceId = value.provinciaId || provinces.find((item) => item.name === value.provinciaNombre)?.id || "";
  const selectedDepartmentId = value.departamentoId || departments.find((item) => item.name === value.departamentoNombre)?.id || "";
  const selectedLocality = localities.find((item) => item.id === value.localidadId || item.name === value.localidadNombre);
  const isReadyToGeocode = Boolean(value.provinciaNombre && value.departamentoNombre && value.localidadNombre && value.calle.trim() && value.numero.trim());

  const set = useCallback((patch: Partial<EmployeeAddress>) => onChange({ ...value, ...patch }), [onChange, value]);
  const resetStreetSearch = useCallback(() => {
    setSelectedStreet(undefined);
    setLastGeocoded("");
    setGeoStatus("");
    setGeoError("");
  }, []);

  const setStreet = useCallback((patch: Partial<EmployeeAddress>) => {
    const next = { ...value, ...patch };
    onChange({ ...next, ubicacionMapa: next.ubicacionMapa.label ? { ...next.ubicacionMapa, label: labelFor(next) } : next.ubicacionMapa });
  }, [onChange, value]);

  useEffect(() => {
    setIsLoadingProvinces(true);
    locationService.getProvincesAsync().then(setProvinces).catch(() => setGeoError(geoServiceErrorMessage)).finally(() => setIsLoadingProvinces(false));
  }, []);

  useEffect(() => {
    if (!selectedProvinceId) return setDepartments([]);
    setIsLoadingDepartments(true);
    locationService.getDepartmentsByProvinceAsync(selectedProvinceId).then(setDepartments).catch(() => setGeoError(geoServiceErrorMessage)).finally(() => setIsLoadingDepartments(false));
  }, [selectedProvinceId]);

  useEffect(() => {
    if (!selectedDepartmentId) return setLocalities([]);
    setIsLoadingLocalities(true);
    locationService.searchLocalitiesAsync({ provinceId: selectedProvinceId, departmentId: selectedDepartmentId }).then(setLocalities).catch(() => setGeoError(geoServiceErrorMessage)).finally(() => setIsLoadingLocalities(false));
  }, [selectedProvinceId, selectedDepartmentId]);

  useEffect(() => {
    if (!selectedDepartmentId || !value.localidadNombre) return setStreets([]);
    const query = streetQuery.trim() || value.calle.trim();
    if (query.length < 2) {
      setStreets([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setIsLoadingStreets(true);
      locationService
        .searchStreetsAsync({ provinceId: selectedProvinceId, departmentId: selectedDepartmentId, localityId: value.localidadId, censusLocalityId: selectedLocality?.censusLocalityId, query })
        .then(setStreets)
        .catch(() => setGeoError(geoServiceErrorMessage))
        .finally(() => setIsLoadingStreets(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [selectedProvinceId, selectedDepartmentId, value.localidadId, value.localidadNombre, value.calle, streetQuery, selectedLocality?.censusLocalityId]);

  const useLocality = (option: GeoOption) => {
    const nextAddress = { ...value, localidadId: option.id, localidadNombre: option.name, calle: "", numero: "", codigoPostal: option.zip || value.codigoPostal };
    const nextMap = option.center ? { lat: option.center.lat, lng: option.center.lng, source: "API" as const, label: labelFor(nextAddress) } : emptyMap;
    resetStreetSearch();
    set({ localidadId: option.id, localidadNombre: option.name, calle: "", numero: "", codigoPostal: option.zip || value.codigoPostal, ubicacionMapa: nextMap, fuenteGeocoding: option.center ? "LOCALITY_CENTER" : undefined });
  };

  const useStreet = (option: GeoOption) => {
    setSelectedStreet(option);
    setStreetQuery(option.name);
    setLastGeocoded("");
    setGeoStatus("");
    setGeoError("");
    setStreet({ calle: option.name, numero: "", ubicacionMapa: value.ubicacionMapa.lat ? { ...value.ubicacionMapa, label: labelFor({ ...value, calle: option.name, numero: "" }) } : value.ubicacionMapa });
  };

  const applyLocalityFallback = useCallback(() => {
    if (!selectedLocality?.center) return false;
    set({
      ubicacionMapa: { lat: selectedLocality.center.lat, lng: selectedLocality.center.lng, source: "API", label: labelFor(value) },
      fuenteGeocoding: "LOCALITY_CENTER",
      direccionNormalizada: "",
      precisionGeocoding: 0.35,
    });
    return true;
  }, [selectedLocality?.center, set, value]);

  const geocode = useCallback(async (silent = false) => {
    if (!isReadyToGeocode || isGeocoding) return;
    const key = [value.provinciaNombre, value.localidadNombre, value.calle, value.numero].join("|");
    setIsGeocoding(true);
    if (!silent) {
      setGeoStatus("Buscando dirección en Georef...");
      setGeoError("");
    }
    try {
      const result = await locationService.geocodeAddressAsync({ provinceName: value.provinciaNombre, departmentName: value.departamentoNombre, localityName: value.localidadNombre, street: value.calle, number: value.numero });
      setLastGeocoded(key);
      if (result?.center) {
        set({
          codigoPostal: result.zip || value.codigoPostal,
          ubicacionMapa: { lat: result.center.lat, lng: result.center.lng, source: "API", label: labelFor(value) },
          direccionNormalizada: result.normalizedAddress,
          fuenteGeocoding: "GEOREF",
          precisionGeocoding: result.confidence,
        });
        if (!silent) setGeoStatus(result.fallback ? addressNotFoundMessage : "Dirección ubicada en el mapa. Puede ajustar el marcador si hace falta.");
        return;
      }
      const hasFallback = applyLocalityFallback();
      if (!silent) setGeoError(hasFallback ? addressNotFoundMessage : geoServiceErrorMessage);
      if (!hasFallback) set({ fuenteGeocoding: "NOT_FOUND" });
    } catch {
      const hasFallback = applyLocalityFallback();
      if (!silent) setGeoError(hasFallback ? addressNotFoundMessage : geoServiceErrorMessage);
    } finally {
      setIsGeocoding(false);
    }
  }, [applyLocalityFallback, isGeocoding, isReadyToGeocode, set, value]);

  useEffect(() => {
    if (readOnly || !includeStreet || !isReadyToGeocode || value.numero.trim().toUpperCase() === "S/N") return;
    const key = [value.provinciaNombre, value.localidadNombre, value.calle, value.numero].join("|");
    if (key === lastGeocoded) return;
    const timer = window.setTimeout(() => { void geocode(true); }, 850);
    return () => window.clearTimeout(timer);
  }, [geocode, includeStreet, isReadyToGeocode, lastGeocoded, readOnly, value.provinciaNombre, value.localidadNombre, value.calle, value.numero]);

  const rangeText = selectedStreet?.heightStart !== undefined && selectedStreet?.heightEnd !== undefined ? `Alturas disponibles aprox.: ${selectedStreet.heightStart} a ${selectedStreet.heightEnd}` : "";
  const numberSuggestions = selectedStreet?.heightStart !== undefined && selectedStreet?.heightEnd !== undefined ? Array.from({ length: Math.min(120, Math.max(0, selectedStreet.heightEnd - selectedStreet.heightStart + 1)) }, (_, index) => String((selectedStreet.heightStart || 0) + index)) : [];

  return <div className="geo-address-fields">
    <GeoSelect label="Provincia" value={value.provinciaNombre} options={provinces} loading={isLoadingProvinces} disabled={readOnly} emptyText="No hay provincias disponibles." onSelect={(option) => { resetStreetSearch(); set({ provinciaId: option.id, provinciaNombre: option.name, departamentoId: "", departamentoNombre: "", localidadId: "", localidadNombre: "", calle: "", numero: "", codigoPostal: "", ubicacionMapa: emptyMap, direccionNormalizada: "", fuenteGeocoding: undefined, precisionGeocoding: undefined }); }} />
    <GeoSelect label="Departamento / Partido" value={value.departamentoNombre} options={departments} loading={isLoadingDepartments} disabled={readOnly || !selectedProvinceId} emptyText="No se encontraron departamentos." onSelect={(option) => { resetStreetSearch(); set({ departamentoId: option.id, departamentoNombre: option.name, localidadId: "", localidadNombre: "", calle: "", numero: "", codigoPostal: "", ubicacionMapa: emptyMap, direccionNormalizada: "", fuenteGeocoding: undefined, precisionGeocoding: undefined }); }} />
    <GeoSelect label="Localidad / Ciudad" value={value.localidadNombre} options={localities} loading={isLoadingLocalities} disabled={readOnly || !selectedDepartmentId} emptyText="No se encontraron localidades." onQuery={(query) => {
      if (query.trim().length >= 2) locationService.searchLocalitiesAsync({ provinceId: selectedProvinceId, departmentId: selectedDepartmentId, query }).then(setLocalities).catch(() => setGeoError(geoServiceErrorMessage));
    }} onSelect={useLocality} />
    {includeStreet && <>
      <GeoSelect label="Dirección / Calle" value={value.calle} options={streets} loading={isLoadingStreets} disabled={readOnly || !value.localidadNombre} emptyText="Escriba al menos dos letras para buscar calles." onQuery={(query) => {
        setStreetQuery(query);
        setStreet({ calle: query, direccionNormalizada: "", fuenteGeocoding: undefined, precisionGeocoding: undefined });
        resetStreetSearch();
      }} onSelect={useStreet} />
      <label>Número<input disabled={readOnly || !value.calle} value={value.numero} list="geo-address-number-list" placeholder={rangeText || "Ingresá número o S/N"} onChange={(event) => { setLastGeocoded(""); setGeoStatus(""); setGeoError(""); setStreet({ numero: event.target.value, direccionNormalizada: "", fuenteGeocoding: undefined, precisionGeocoding: undefined }); }} />{rangeText && <small>{rangeText}</small>}<datalist id="geo-address-number-list">{numberSuggestions.map((number) => <option key={number} value={number} />)}</datalist></label>
    </>}
    <label>Código postal<input disabled={readOnly} value={value.codigoPostal} onChange={(event) => set({ codigoPostal: event.target.value })} /></label>
    {includeStreet && showGeoActions && <div className="geo-address-actions">
      <a className={`button subtle ${isReadyToGeocode ? "" : "disabled-link"}`} href={isReadyToGeocode ? googleMapsUrl(value) : undefined} target="_blank" rel="noreferrer">Abrir en Google Maps</a>
      <small>La localidad centra el mapa automáticamente. Para una ubicación exacta, abrí Google Maps y pegá luego el link en el mapa.</small>
      {geoStatus && <small className="geo-status ok">{geoStatus}</small>}
      {geoError && <small className="geo-status warn">{geoError}</small>}
    </div>}
  </div>;
}
