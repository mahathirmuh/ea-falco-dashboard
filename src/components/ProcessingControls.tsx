import { Play, Trash2, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface ProcessingControlsProps {
  imageCount: number;
  processedCount: number;
  onProcess: () => void;
  onClearAll: () => void;
  isProcessing: boolean;
}

const ProcessingControls = ({
  imageCount,
  processedCount,
  onProcess,
  onClearAll,
  isProcessing,
}: ProcessingControlsProps) => {
  const progress = (processedCount / imageCount) * 100;

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium text-card-foreground">
                Processing Progress
              </h3>
              <span className="text-sm text-muted-foreground">
                {processedCount} / {imageCount}
              </span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={onProcess}
              disabled={isProcessing || processedCount === imageCount}
              className="bg-gradient-to-r from-primary to-accent hover:opacity-90"
            >
              <Play className="mr-2 h-4 w-4" />
              {isProcessing ? "Processing..." : "Process All"}
            </Button>
            <Button
              variant="outline"
              onClick={onClearAll}
              disabled={isProcessing}
              className="hover:border-destructive hover:bg-destructive hover:text-destructive-foreground"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear All
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ProcessingControls;
