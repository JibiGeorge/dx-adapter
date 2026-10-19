export interface ProviderSearchDto {
  lat: number | string;
  long: number | string;
  radius?: number | string;
  query?: string;
  typeOfService?: string;
}

export interface MedicalProviderItem {
  id: number;
  typeOfService: string;
  networkPartner: string;
  name: string;
  address: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  distanceKm?: number;
}

export interface ProviderSearchResponse {
  isSuccess: boolean;
  total: number;
  providers: MedicalProviderItem[];
  message?: string;
}

export interface GeocodeResult {
  placeId: string | number;
  displayName: string;
  name?: string;
  lat: number;
  lon: number;
  type?: string;
}
