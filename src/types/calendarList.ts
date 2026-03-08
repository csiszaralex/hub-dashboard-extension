export interface ICalendarList {
  kind: 'calendar#calendarListEntry';
  etag: string; //etag
  id: string;
  summary: string;
  description: string;
  location: string;
  timeZone: string;
  dataOwner: string;
  summaryOverride: string;
  colorId: string;
  backgroundColor: string;
  foregroundColor: string;
  hidden: boolean;
  selected: boolean;
  accessRole: string;
  defaultReminders: [
    {
      method: string;
      minutes: number;
    },
  ];
  notificationSettings: {
    notifications: [
      {
        type: string;
        method: string;
      },
    ];
  };
  primary: boolean;
  deleted: boolean;
  conferenceProperties: {
    allowedConferenceSolutionTypes: [string];
  };
  autoAcceptInvitations: boolean;
}
