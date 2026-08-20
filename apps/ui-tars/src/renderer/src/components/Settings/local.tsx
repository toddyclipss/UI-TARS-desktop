import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Button } from '@renderer/components/ui/button';
import { LocalStore } from '@main/store/validate';

import { VLMSettings, VLMSettingsRef } from './category/vlm';
import { useRef } from 'react';

interface LocalSettingsDialogProps {
  isOpen: boolean;
  onSubmit: () => void;
  onClose: () => void;
}

export const checkVLMSettings = async () => {
  const settingRpc = window.electron.setting;

  const currentSetting = ((await settingRpc.getSetting()) ||
    {}) as Partial<LocalStore>;
  const { vlmApiKey, vlmBaseUrl, vlmModelName, vlmProvider } = currentSetting;

  if (vlmApiKey && vlmBaseUrl && vlmModelName && vlmProvider) {
    return true;
  }

  return false;
};

import { toast } from 'sonner';

export const LocalSettingsDialog = ({
  isOpen,
  onSubmit,
  onClose,
}: LocalSettingsDialogProps) => {
  const vlmSettingsRef = useRef<VLMSettingsRef>(null);

  const handleGetStart = async () => {
    try {
      await vlmSettingsRef.current?.submit();
      onSubmit();
    } catch (error) {
      console.error('Failed to submit settings:', error);
      toast.error('Please configure your VLM API Key to start');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>VLM Settings</DialogTitle>
          <DialogDescription>
            Enter your VLM settings (Google Gemini) to enable the model to
            control the local computer or browser.
          </DialogDescription>
        </DialogHeader>
        <VLMSettings ref={vlmSettingsRef} autoSave={true} />
        <Button className="mt-6 mx-6" onClick={handleGetStart}>
          Get Started
        </Button>
      </DialogContent>
    </Dialog>
  );
};

