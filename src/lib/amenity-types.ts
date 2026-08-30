/**
 * Client-safe amenity shapes.
 *
 * Every type here is something a browser is allowed to hold. Notably absent:
 * blob storage URLs, internal note bodies, another resident's identity on a
 * booking, and any coordinate. Photos are referenced by `mediaId` only, and
 * are fetched through an endpoint that re-checks authorization per request.
 */

export type AmenityType =
  | "pool"
  | "clubhouse"
  | "gym"
  | "tennis_court"
  | "badminton_court"
  | "basketball_court"
  | "meeting_room"
  | "barbecue_area"
  | "playground"
  | "park"
  | "other";

export type AmenityStatus = "draft" | "published" | "archived";

export type AmenityOperationalStatus =
  | "open"
  | "closed"
  | "maintenance"
  | "temporarily_unavailable";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type AmenityBookingStatus =
  | "pending_approval"
  | "confirmed"
  | "declined"
  | "cancelled_by_resident"
  | "cancelled_by_manager"
  | "completed"
  | "no_show";

export type AmenityIssueStatus =
  | "new"
  | "acknowledged"
  | "investigating"
  | "waiting_on_resident"
  | "resolved"
  | "closed";

export type AmenityIssueCategory =
  | "damage"
  | "cleanliness"
  | "safety"
  | "access"
  | "equipment"
  | "reservation_conflict"
  | "noise"
  | "other";

export type AmenityIssuePriority = "low" | "normal" | "high" | "urgent";

export const AMENITY_TYPE_LABELS: Record<AmenityType, string> = {
  pool: "Pool",
  clubhouse: "Clubhouse",
  gym: "Gym",
  tennis_court: "Tennis court",
  badminton_court: "Badminton court",
  basketball_court: "Basketball court",
  meeting_room: "Meeting room",
  barbecue_area: "Barbecue area",
  playground: "Playground",
  park: "Park",
  other: "Amenity",
};

export const OPERATIONAL_STATUS_LABELS: Record<AmenityOperationalStatus, string> = {
  open: "Open",
  closed: "Closed",
  maintenance: "Maintenance",
  temporarily_unavailable: "Temporarily unavailable",
};

export const BOOKING_STATUS_LABELS: Record<AmenityBookingStatus, string> = {
  pending_approval: "Awaiting approval",
  confirmed: "Confirmed",
  declined: "Declined",
  cancelled_by_resident: "Cancelled",
  cancelled_by_manager: "Cancelled by manager",
  completed: "Completed",
  no_show: "No show",
};

export const ISSUE_STATUS_LABELS: Record<AmenityIssueStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  investigating: "Investigating",
  waiting_on_resident: "Waiting on you",
  resolved: "Resolved",
  closed: "Closed",
};

export const ISSUE_CATEGORY_LABELS: Record<AmenityIssueCategory, string> = {
  damage: "Damage",
  cleanliness: "Cleanliness",
  safety: "Safety",
  access: "Access",
  equipment: "Equipment",
  reservation_conflict: "Reservation conflict",
  noise: "Noise",
  other: "Other",
};

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export type MediaRef = {
  id: string;
  /** Authenticated delivery path; never a storage URL. */
  url: string;
  width: number | null;
  height: number | null;
};

export type AmenityHoursView = {
  weekday: Weekday;
  opensMinute: number;
  closesMinute: number;
  label: string;
};

/** One card in the resident catalog. */
export type AmenityCardView = {
  id: string;
  name: string;
  type: AmenityType;
  typeLabel: string;
  status: AmenityStatus;
  operationalStatus: AmenityOperationalStatus;
  operationalNote: string | null;
  reopensAt: string | null;
  locationLabel: string | null;
  bookingRequired: boolean;
  cover: MediaRef | null;
  /** Today's window, or the next open period when closed right now. */
  hoursLabel: string | null;
  nextOpenLabel: string | null;
  /** Only present for a bookable amenity with a free slot in the horizon. */
  nextAvailable: { startsAt: string; label: string } | null;
  capacityLabel: string | null;
  averageRating: number | null;
  reviewCount: number;
};

export type AmenityClosureView = {
  id: string;
  kind: "blackout" | "maintenance" | "holiday" | "private_event";
  startsAt: string | null;
  endsAt: string | null;
  recurringWeekday: Weekday | null;
  recurringStartMinute: number | null;
  recurringEndMinute: number | null;
  residentVisible: boolean;
  reason: string | null;
  label: string;
};

export type AmenityPolicyView = {
  slotMinutes: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  bufferMinutes: number;
  maxPartySize: number;
  advanceDays: number;
  minNoticeMinutes: number;
  cancellationCutoffMinutes: number;
  maxActiveBookingsPerResident: number;
  maxActiveBookingsPerUnit: number | null;
  approvalRequired: boolean;
};

export type RatingDistribution = {
  rating: 1 | 2 | 3 | 4 | 5;
  count: number;
  percent: number;
};

export type AmenityReviewView = {
  id: string;
  rating: number;
  comment: string;
  authorName: string;
  isMine: boolean;
  verifiedBooking: boolean;
  createdAt: string;
  editedAt: string | null;
  photos: MediaRef[];
  response: {
    body: string;
    responderName: string;
    createdAt: string;
  } | null;
};

export type AmenityReviewSummary = {
  averageRating: number | null;
  reviewCount: number;
  distribution: RatingDistribution[];
};

export type AmenityDetailView = AmenityCardView & {
  description: string | null;
  features: string[];
  rules: string | null;
  permittedUses: string | null;
  ageRestriction: string | null;
  guestPolicy: string | null;
  cancellationPolicy: string | null;
  contactInstructions: string | null;
  gallery: MediaRef[];
  hours: AmenityHoursView[];
  /** Resident-visible closures only. Private events appear as plain gaps. */
  closures: AmenityClosureView[];
  policy: AmenityPolicyView | null;
  resourceCount: number;
  reviewSummary: AmenityReviewSummary;
  /** Whether this viewer may post a review right now, and why not. */
  reviewEligibility: {
    canReview: boolean;
    reason: string | null;
    /** Completed bookings still awaiting a review. */
    eligibleBookingIds: string[];
  };
  myUpcomingBookings: BookingView[];
};

export type SlotView = {
  startsAt: string;
  endsAt: string;
  startLabel: string;
  endLabel: string;
  available: boolean;
  remaining: number;
  reason: string | null;
};

export type AvailabilityDayView = {
  date: string;
  weekday: Weekday;
  open: boolean;
  closedReason: string | null;
  slots: SlotView[];
};

export type BookingView = {
  id: string;
  reference: string;
  amenityId: string;
  amenityName: string;
  status: AmenityBookingStatus;
  statusLabel: string;
  startsAt: string;
  endsAt: string;
  /** Rendered in the HOA's timezone, so the client needs no zone logic. */
  whenLabel: string;
  timezone: string;
  partySize: number;
  resourceLabel: string;
  note: string | null;
  cancellationReason: string | null;
  /** False once the cancellation cutoff has passed. */
  canCancel: boolean;
  canReschedule: boolean;
  canReview: boolean;
  createdAt: string;
};

/** The manager's calendar row. Adds the resident, which residents never see. */
export type ManagerBookingView = BookingView & {
  residentName: string;
  residentEmail: string;
  unitLabel: string | null;
  isManagerBlock: boolean;
  approvalRequired: boolean;
};

export type AmenityIssueMessageView = {
  id: string;
  body: string;
  authorName: string;
  /** `internal_note` never appears in a resident payload at all. */
  kind: "resident_message" | "manager_reply" | "internal_note";
  isMine: boolean;
  createdAt: string;
};

export type AmenityIssueEventView = {
  id: string;
  type: string;
  actorName: string | null;
  fromStatus: AmenityIssueStatus | null;
  toStatus: AmenityIssueStatus | null;
  createdAt: string;
};

export type AmenityIssueView = {
  id: string;
  reference: string;
  amenityId: string;
  amenityName: string;
  category: AmenityIssueCategory;
  categoryLabel: string;
  priority: AmenityIssuePriority;
  status: AmenityIssueStatus;
  statusLabel: string;
  subject: string;
  description: string;
  reporterName: string;
  assignedToName: string | null;
  resolutionSummary: string | null;
  photos: MediaRef[];
  messages: AmenityIssueMessageView[];
  events: AmenityIssueEventView[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  canWithdraw: boolean;
  canReopen: boolean;
};

export type AmenityCatalog = {
  communityId: string;
  communityName: string;
  timezone: string;
  canManage: boolean;
  amenities: AmenityCardView[];
  myUpcomingBookings: BookingView[];
  myOpenIssues: Array<Pick<AmenityIssueView, "id" | "reference" | "subject" | "status" | "statusLabel" | "amenityName">>;
};

export type ManagerAmenityWorkspace = {
  communityId: string;
  communityName: string;
  timezone: string;
  amenities: AmenityCardView[];
  upcomingBookings: ManagerBookingView[];
  pendingApprovals: ManagerBookingView[];
  openIssues: AmenityIssueView[];
  staff: Array<{ id: string; name: string; role: string }>;
  utilization: Array<{
    amenityId: string;
    amenityName: string;
    bookingsLast30Days: number;
    openIssues: number;
    averageRating: number | null;
  }>;
};
