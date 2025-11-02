import { useRef } from "react";
import { Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ImageUploadZoneProps {
  onFilesSelected: (files: FileList | null) => void;
}

const ImageUploadZone = ({ onFilesSelected }: ImageUploadZoneProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    onFilesSelected(files);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFilesSelected(e.target.files);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <Card
      className="border-2 border-dashed border-border bg-gradient-to-br from-card to-muted/30 shadow-[var(--shadow-card)] transition-all duration-300 hover:border-primary hover:shadow-[var(--shadow-elevated)]"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <CardContent className="flex flex-col items-center justify-center py-12">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent">
          <Upload className="h-8 w-8 text-primary-foreground" />
        </div>
        <h3 className="mt-4 text-lg font-semibold text-card-foreground">
          Upload ID Card Images
        </h3>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Drag and drop your images here, or click to browse
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Supports: JPG, JPEG, PNG
        </p>
        <Button
          onClick={handleClick}
          className="mt-6 bg-gradient-to-r from-primary to-accent hover:opacity-90"
          size="lg"
        >
          <Upload className="mr-2 h-4 w-4" />
          Choose Files
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/jpg,image/png"
          onChange={handleFileSelect}
          className="hidden"
        />
      </CardContent>
    </Card>
  );
};

export default ImageUploadZone;
