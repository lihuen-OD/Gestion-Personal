import { lazy, Suspense } from "react";
import type { Employee } from "../../types";
import { GeoAddressFields } from "../GeoAddressFields";
import { Field } from "../ui/FormControls";

const LocationMapPicker = lazy(() =>
  import("../LocationMapPicker").then((module) => ({ default: module.LocationMapPicker })),
);

export function ContactAddressFields({
  value,
  setValue,
  readOnly = false,
}: {
  value: Employee;
  setValue: (employee: Employee) => void;
  readOnly?: boolean;
}) {
  const update = (field: keyof Employee, next: Employee[keyof Employee]) =>
    setValue({ ...value, [field]: next });
  const setAddress = (patch: Partial<Employee["domicilio"]>) => {
    const nextAddress = {
      ...value.domicilio,
      ...patch,
      ...(patch.ubicacionMapa?.source === "MANUAL" ? ({ fuenteGeocoding: "MANUAL_MARKER" } as const) : null),
    };
    setValue({
      ...value,
      domicilio: nextAddress,
      addressStreet: nextAddress.calle,
      address: nextAddress.calle,
      addressNumber: nextAddress.numero,
      province: nextAddress.provinciaNombre,
      department: nextAddress.departamentoNombre,
      city: nextAddress.localidadNombre,
      zip: nextAddress.codigoPostal,
      locationMap: nextAddress.ubicacionMapa,
      mapLocation: nextAddress.ubicacionMapa.label,
    });
  };

  return (
    <>
      <div className="form-grid">
        <Field label="Telefono" value={value.phone} set={(next) => update("phone", next)} />
        <Field label="Celular" value={value.mobile} set={(next) => update("mobile", next)} />
        <Field label="Email" value={value.email} set={(next) => update("email", next)} />
        <div className="form-wide">
          <GeoAddressFields value={value.domicilio} onChange={(address) => setAddress(address)} readOnly={readOnly} />
        </div>
        <Field label="Contacto de emergencia" value={value.emergencyContact} set={(next) => update("emergencyContact", next)} />
        <Field label="Parentesco" value={value.emergencyRelation} set={(next) => update("emergencyRelation", next)} />
        <Field label="Telefono de emergencia" value={value.emergencyPhone} set={(next) => update("emergencyPhone", next)} />
      </div>
      <Suspense fallback={<div className="location-map-card">Cargando mapa...</div>}>
        <LocationMapPicker
          provinceName={value.domicilio.provinciaNombre}
          departmentName={value.domicilio.departamentoNombre}
          localityName={value.domicilio.localidadNombre}
          addressStreet={value.domicilio.calle}
          addressNumber={value.domicilio.numero}
          value={value.domicilio.ubicacionMapa}
          readOnly={readOnly}
          onChange={(ubicacionMapa) => setAddress({ ubicacionMapa })}
        />
      </Suspense>
    </>
  );
}
