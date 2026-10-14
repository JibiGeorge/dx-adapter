import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '../../../common/http/http.service';

@Injectable()
export class ClaimApiService {
    private readonly logger = new Logger(ClaimApiService.name);

    constructor(
        private readonly httpService: HttpService,
    ) { }

    async searchPoliciesByAgent(
        brokerId: string | number,
        allowedTPAIds: number[],
        baseUrl: string,
    ) {
        this.logger.debug(`Searching policies for broker: ${brokerId}`);

        const response: any = await this.httpService.post(`${baseUrl}/policy/search/agentcode`, {
            BrokerId: brokerId,
            MandateBrokerName: null,
            AllowedTPAIds: allowedTPAIds
        })

        if (!response.isSuccess) {
            throw new Error(`Failed to fetch policies for broker: ${brokerId}`);
        }

        return response;
    }

    async searchPoliciesByGroupCorp(groupCorpId: number, tenantId: string, baseUrl: string, accessKey: string, ShowallClaims: boolean) {
        const payload = {
            GroupCorporateIds: [groupCorpId],
            Range: 100,
            StartIndex: 0
        }

        const response: any = await fetch(`${baseUrl}/api/v2/PolicySearch/.json`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CA-SHARED-KEY': accessKey,
                'Payer': tenantId,
                'LoadArchive': ShowallClaims ? 'True' : 'False',
            },
            body: JSON.stringify(payload),
        })

        if (!response.ok) {
            throw new Error(`Failed to fetch policies for group corp: ${groupCorpId}`);
        }

        return response.json();
    }
}