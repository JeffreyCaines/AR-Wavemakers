export type ExperienceViewOptions = {
  onReady?: () => void;
  onFailed?: () => void;
  onExit?: (historySteps?: number) => void;
};
