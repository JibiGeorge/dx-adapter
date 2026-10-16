export interface UserProfileResponse {
  userId: number;
  userName: string;
  loginName: string;
  emailId: string;
  mobile: string;
  address: string;
  altMobile?: string;
  altEmailId?: string;
  profileImgUrl?: string;
  maid?: number;
  empCode?: string;
  phonePrefix: string;
  brokerCode?: string;
  role: string;
}

export interface ProfileOperationResult {
  success: boolean;
  message: string;
  profileImgUrl?: string;
  data?: any;
}
