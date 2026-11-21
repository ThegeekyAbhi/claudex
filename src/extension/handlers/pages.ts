import type { HandlersFor } from '../action-groups';

export interface PagesHandlersContext {
  open(id: string): Promise<void>;
  openToday(): Promise<void>;
  browse(): Promise<void>;
}

/** What the chat may do with your pages: open one, today's page, or pick one. */
export class PagesHandlers {
  constructor(private context: PagesHandlersContext) {}
  handlers(): HandlersFor<'pages'> {
    return {
      pageOpen: async (action) => {
        await this.context.open(action.id);
      },
      openTodayPage: async () => {
        await this.context.openToday();
      },
      browsePages: async () => {
        await this.context.browse();
      },
    };
  }
}
