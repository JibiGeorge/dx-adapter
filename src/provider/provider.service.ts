import { Injectable } from '@nestjs/common';
import { HttpService } from '../../common/http/http.service.js';
import { LoggingService } from '../../common/logging/logging.service.js';
import {
  ProviderSearchDto,
  MedicalProviderItem,
  ProviderSearchResponse,
  GeocodeResult,
} from './provider.types.js';

interface GeocodeCacheItem {
  timestamp: number;
  data: GeocodeResult[];
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

@Injectable()
export class ProviderService {
  private readonly geocodeCache = new Map<string, GeocodeCacheItem>();

  constructor(
    private readonly httpService: HttpService,
    private readonly logger: LoggingService,
  ) {}

  /**
   * Search medical providers by coordinates, radius, and optional filters
   */
  async searchProviders(
    tenantId: string,
    dto: ProviderSearchDto,
  ): Promise<ProviderSearchResponse> {
    const lat = Number(dto.lat);
    const lon = Number(dto.long);
    const radius = Number(dto.radius || 20);

    if (isNaN(lat) || isNaN(lon)) {
      return {
        isSuccess: false,
        total: 0,
        providers: [],
        message: 'Valid latitude and longitude coordinates are required.',
      };
    }

    const tpaName = 'Lawton';
    const endpoint = 'https://network-api.lawtonasia.com/network';

    this.logger.log(
      `Searching medical providers for tenant ${tenantId} at [${lat}, ${lon}] with radius ${radius}km`,
      ProviderService.name,
    );

    try {
      const payload = {
        lat: String(lat),
        long: String(lon),
        radius: String(radius),
        TPA: tpaName,
      };

      // Perform upstream call with up to 3 resilient retries
      let response: any[] | null = null;
      let lastError: any = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          response = await this.httpService.post<any[]>(endpoint, payload, {
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'CrossLink-Enterprise-Portal/1.0 (health@lawtonasia.com)',
            },
            timeoutMs: 20_000,
          });
          if (Array.isArray(response)) {
            break;
          }
        } catch (err: any) {
          lastError = err;
          this.logger.warn(
            `Medical provider upstream search attempt ${attempt}/3 failed: ${err.message}`,
            ProviderService.name,
          );
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
          }
        }
      }

      if (!Array.isArray(response)) {
        if (lastError) {
          throw lastError;
        }
        return {
          isSuccess: true,
          total: 0,
          providers: [],
          message: 'No medical providers found in this radius.',
        };
      }

      // Map and enrich with calculated distance (defensively handling any malformed upstream objects)
      let items: MedicalProviderItem[] = response
        .filter((item: any) => item && typeof item === 'object')
        .map((item: any) => {
          const itemLat = Number(item.latitude || item.lat || 0);
          const itemLon = Number(item.longitude || item.long || item.lon || 0);
          const dist =
            itemLat && itemLon
              ? calculateHaversineDistance(lat, lon, itemLat, itemLon)
              : undefined;

          return {
            id: Number(item.id || item.hospitalId || 0),
            typeOfService: String(item.typeOfService || 'Hospital').trim(),
            networkPartner: String(item.networkPartner || tpaName).trim(),
            name: String(item.name || item.hospitalName || '').trim(),
            address: String(item.address || '').trim(),
            formattedAddress: String(item.formattedAddress || item.address || '').trim(),
            latitude: itemLat,
            longitude: itemLon,
            distanceKm: dist,
          };
        });

      // Filter by type of service if requested
      if (dto.typeOfService && dto.typeOfService.toLowerCase() !== 'all') {
        const targetType = dto.typeOfService.toLowerCase().trim();
        items = items.filter((p) =>
          p.typeOfService.toLowerCase().includes(targetType),
        );
      }

      // Filter by search text query if provided
      if (dto.query && dto.query.trim()) {
        const q = dto.query.toLowerCase().trim();
        items = items.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.formattedAddress.toLowerCase().includes(q) ||
            p.address.toLowerCase().includes(q),
        );
      }

      // Filter strictly by requested radius distance (prevents any out-of-bounds leak from upstream API)
      items = items.filter(
        (p) => p.distanceKm === undefined || p.distanceKm <= radius,
      );

      // Sort by distance ascending
      items.sort((a, b) => (a.distanceKm ?? 99999) - (b.distanceKm ?? 99999));

      return {
        isSuccess: true,
        total: items.length,
        providers: items,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to search medical providers: ${err.message}`,
        err.stack,
        ProviderService.name,
      );
      return {
        isSuccess: false,
        total: 0,
        providers: [],
        message: 'Unable to retrieve medical providers from the network service.',
      };
    }
  }

  /**
   * Geocode a location text string using OpenStreetMap Nominatim with caching
   */
  async geocodeLocation(query: string, lang = 'en'): Promise<GeocodeResult[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery || cleanQuery.length < 2) {
      return [];
    }

    const cacheKey = `${lang}:${cleanQuery.toLowerCase()}`;
    const cached = this.geocodeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=0&limit=8&q=${encodeURIComponent(
      cleanQuery,
    )}&accept-language=${encodeURIComponent(lang)}`;

    try {
      const response = await this.httpService.get<any[]>(url, {
        headers: {
          'User-Agent': 'CrossLink-Enterprise-Portal/1.0 (health@lawtonasia.com)',
        },
        timeoutMs: 8_000,
      });

      if (!Array.isArray(response)) {
        return [];
      }

      const results: GeocodeResult[] = response.map((item: any) => ({
        placeId: item.place_id,
        displayName: item.display_name,
        name: item.name || item.display_name.split(',')[0],
        lat: Number(item.lat),
        lon: Number(item.lon),
        type: item.type,
      }));

      this.geocodeCache.set(cacheKey, {
        timestamp: Date.now(),
        data: results,
      });

      return results;
    } catch (err: any) {
      this.logger.warn(
        `Geocoding lookup failed for query "${cleanQuery}": ${err.message}`,
        ProviderService.name,
      );
      return [];
    }
  }
}
