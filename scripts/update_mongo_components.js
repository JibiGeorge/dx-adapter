/**
 * Script to synchronize ComponentConfiguration in MongoDB (IPMI_Tenant_STG)
 * with the exact authentic legacy card names and descriptions extracted directly from
 * mayfairmemberportal Razor views (across branches: main and lawtonAsiaUAT).
 */
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://srv_uat_ltn:Zen078FAe8W47gv7oZpt@10.90.2.121:27017/MEMBER_CONFIG_STG?directConnection=true&authSource=admin';
const DB_NAME = 'IPMI_Tenant_STG';
const COLLECTION_NAME = 'ComponentConfiguration';

const TENANT_MAYFAIR = 'MjAxOXxNV0MxMjM0NTY=';
const TENANT_LAWTON = 'MzAyNHxMYXd0b25Bc2lhIzIwMjZATWF5';

const PORTAL_COMPONENTS = [
  // 1. Mayfair Corporate (Source: Site/Views/HRHome/TPAIndexHRMWC.cshtml on main)
  {
    portalKey: 'MayfairCorporate',
    tenantId: TENANT_MAYFAIR,
    portal: 'corporate',
    role: 'HR',
    components: [
      {
        id: 'MayfairCorporateInsights',
        name: 'Insights',
        order: 1,
        description: 'View key membership and health metrics and reports.',
      },
      {
        id: 'MayfairCorporateDownloadEcards',
        name: 'Download E-Cards',
        order: 2,
        description: 'Get your digital insurance card instantly.',
      },
      {
        id: 'MayfairCorporateSearchMedicalProvider',
        name: 'Search Medical Provider',
        order: 3,
        description: 'Find network hospitals for cashless care.',
      },
      {
        id: 'MayfairCorporateProfile',
        name: 'Profile',
        order: 4,
        description: 'See profile details.',
      },
      {
        id: 'MayfairCorporatePolicyDetails',
        name: 'Policy Details',
        order: 5,
        description: 'See employee policy information.',
      },
      {
        id: 'MayfairCorporateMemberEnrollment',
        name: 'Member Enrollment',
        order: 6,
        description: 'Enroll your team and their families in just seconds.',
      },
      {
        id: 'MayfairCorporateTrackClaims',
        name: 'Track Claims',
        order: 7,
        description: "Monitor your team's claims in real time.",
      },
    ],
  },

  // 2. Mayfair Partner (Source: Site/Views/BrokerHome/IndexBrokerMayfair.cshtml on main)
  {
    portalKey: 'MayfairPartner',
    tenantId: TENANT_MAYFAIR,
    portal: 'partner',
    role: 'Broker',
    components: [
      {
        id: 'MayfairPartnerInsights',
        name: 'Insights',
        order: 1,
        description: 'View key membership and health metrics and reports.',
      },
      {
        id: 'MayfairPartnerSearchMedicalProvider',
        name: 'Search Medical Provider',
        order: 2,
        description: 'Find network hospitals for cashless care.',
      },
      {
        id: 'MayfairPartnerViewClaims',
        name: 'View Claims',
        order: 3,
        description: "Monitor your team's claims in real time.",
      },
      {
        id: 'MayfairPartnerProfile',
        name: 'Profile',
        order: 4,
        description: 'View your profile details.',
      },
      {
        id: 'MayfairPartnerPolicyCoverage',
        name: 'Policy Coverage',
        order: 5,
        description: 'See employee policy information.',
      },
    ],
  },

  // 3. Mayfair Insurer (Source: Site/Views/MayFairHome/IndexMayfair.cshtml on main)
  {
    portalKey: 'MayfairInsurer',
    tenantId: TENANT_MAYFAIR,
    portal: 'insurer',
    role: 'Insurer',
    components: [
      {
        id: 'MayfairInsurerProfile',
        name: 'Profile',
        order: 1,
        description: 'View your profile details.',
      },
      {
        id: 'MayfairInsurerInsights',
        name: 'Insights',
        order: 2,
        description: 'View key membership and health metrics and reports.',
      },
      {
        id: 'MayfairInsurerSearchMedicalProvider',
        name: 'Search Medical Provider',
        order: 3,
        description: 'Find network hospitals for cashless care.',
      },
      {
        id: 'MayfairInsurerViewClaims',
        name: 'View Claims',
        order: 4,
        description: "Monitor your team's claims in real time.",
      },
      {
        id: 'MayfairInsurerPolicyCoverage',
        name: 'Policy Coverage',
        order: 5,
        description: 'See employee policy information.',
      },
      {
        id: 'MayfairInsurerFTIDashboard',
        name: 'FTI Dashboard',
        order: 6,
        description: 'View the claim dashboard data.',
      },
    ],
  },

  // 4. Lawton Corporate (Source: Site/Views/HRHome/LawtonIndexHR.cshtml on lawtonAsiaUAT)
  {
    portalKey: 'LawtonCorporate',
    tenantId: TENANT_LAWTON,
    portal: 'corporate',
    role: 'HR',
    components: [
      {
        id: 'LawtonCorporateInsights',
        name: 'Insights',
        order: 1,
        description: 'View key membership and health metrics and reports.',
      },
      {
        id: 'LawtonCorporateDownloadEcards',
        name: 'Download E-Cards',
        order: 2,
        description: 'Get your digital insurance card instantly.',
      },
      {
        id: 'LawtonCorporateSearchMedicalProvider',
        name: 'Search Medical Provider',
        order: 3,
        description: 'Find network hospitals for cashless care.',
      },
      {
        id: 'LawtonCorporateMemberDashboard',
        name: 'Member Dashboard',
        order: 4,
        description: 'Track enrollment status and broker decisions.',
      },
      {
        id: 'LawtonCorporateMemberDataUpload',
        name: 'Member Data Upload',
        order: 5,
        description: 'Search corporate, select policy and upload member CSV.',
      },
      {
        id: 'LawtonCorporateProfile',
        name: 'Profile',
        order: 6,
        description: 'See profile details.',
      },
      {
        id: 'LawtonCorporateMemberDetails',
        name: 'Member Details',
        order: 7,
        description: 'See employee policy information.',
      },
    ],
  },

  // 5. Lawton Partner (Source: Site/Views/BrokerHome/IndexBrokerMayfair.cshtml on lawtonAsiaUAT)
  {
    portalKey: 'LawtonPartner',
    tenantId: TENANT_LAWTON,
    portal: 'partner',
    role: 'Broker',
    components: [
      {
        id: 'LawtonPartnerInsights',
        name: 'Insights',
        order: 1,
        description: 'View key membership and health metrics and reports.',
      },
      {
        id: 'LawtonPartnerDownloadEcards',
        name: 'Download E-Cards',
        order: 2,
        description: 'Get your digital insurance card instantly.',
      },
      {
        id: 'LawtonPartnerSearchMedicalProvider',
        name: 'Search Medical Provider',
        order: 3,
        description: 'Find network hospitals for cashless care.',
      },
      {
        id: 'LawtonPartnerMemberDashboard',
        name: 'Member Dashboard',
        order: 4,
        description: 'Review and approve employee enrollment requests.',
      },
      {
        id: 'LawtonPartnerMemberDataUpload',
        name: 'Member Data Upload',
        order: 5,
        description: 'Search corporate, select policy and upload member CSV.',
      },
      {
        id: 'LawtonPartnerProfile',
        name: 'Profile',
        order: 6,
        description: 'View your profile details.',
      },
      {
        id: 'LawtonPartnerViewClaims',
        name: 'View Claims',
        order: 7,
        description: "Monitor your team's claims in real time.",
      },
      {
        id: 'LawtonPartnerClaimSubmission',
        name: 'Claim Submission',
        order: 8,
        description: 'Submit a new claim for your team members.',
      },
      {
        id: 'LawtonPartnerClientDetails',
        name: 'Client Details',
        order: 9,
        description: 'See employee policy information.',
      },
      {
        id: 'LawtonPartnerPolicyList',
        name: 'Policy List',
        order: 10,
        description: 'View and manage all policies with beneficiary details.',
      },
    ],
  },
];

async function updateComponentConfiguration() {
  const client = new MongoClient(MONGODB_URI);

  try {
    console.log(`Connecting to MongoDB (${DB_NAME})...`);
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    for (const portalConfig of PORTAL_COMPONENTS) {
      console.log(`Updating authentic components for ${portalConfig.portalKey} (${portalConfig.role})...`);
      const result = await collection.updateOne(
        { portalKey: portalConfig.portalKey },
        {
          $set: {
            tenantId: portalConfig.tenantId,
            portalKey: portalConfig.portalKey,
            portal: portalConfig.portal,
            role: portalConfig.role,
            components: portalConfig.components,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );

      console.log(`✓ ${portalConfig.portalKey}: matched ${result.matchedCount}, modified ${result.modifiedCount}, upserted ${result.upsertedCount}`);
    }

    console.log('\nAll 5 portal configurations updated with authentic legacy descriptions in MongoDB!');
  } catch (error) {
    console.error('Error updating ComponentConfiguration:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  updateComponentConfiguration();
}

module.exports = { updateComponentConfiguration };
