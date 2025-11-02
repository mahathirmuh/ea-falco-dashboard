import { useState } from "react";
import { Upload, Image as ImageIcon, Download, Trash2, Crop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import ImageUploadZone from "@/components/ImageUploadZone";
import ImageGrid from "@/components/ImageGrid";
import ProcessingControls from "@/components/ProcessingControls";

export interface ImageFile {
  id: string;
  file: File;
  preview: string;
  processed?: string;
  status: "pending" | "processing" | "completed";
}

const Index = () => {
  const [images, setImages] = useState<ImageFile[]>([]);
  const { toast } = useToast();

  const handleFilesSelected = (files: FileList | null) => {
    if (!files) return;

    const newImages: ImageFile[] = Array.from(files).map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      preview: URL.createObjectURL(file),
      status: "pending" as const,
    }));

    setImages((prev) => [...prev, ...newImages]);
    toast({
      title: "Images uploaded",
      description: `${files.length} image(s) added successfully`,
    });
  };

  const handleRemoveImage = (id: string) => {
    setImages((prev) => {
      const image = prev.find((img) => img.id === id);
      if (image) {
        URL.revokeObjectURL(image.preview);
        if (image.processed) URL.revokeObjectURL(image.processed);
      }
      return prev.filter((img) => img.id !== id);
    });
  };

  const handleProcessImages = async () => {
    toast({
      title: "Processing started",
      description: "Your images are being processed...",
    });

    // Simulate processing
    for (const image of images) {
      setImages((prev) =>
        prev.map((img) =>
          img.id === image.id ? { ...img, status: "processing" } : img
        )
      );

      // Simulate processing delay
      await new Promise((resolve) => setTimeout(resolve, 1000));

      setImages((prev) =>
        prev.map((img) =>
          img.id === image.id
            ? { ...img, status: "completed", processed: img.preview }
            : img
        )
      );
    }

    toast({
      title: "Processing complete",
      description: "All images have been processed successfully",
    });
  };

  const handleClearAll = () => {
    images.forEach((image) => {
      URL.revokeObjectURL(image.preview);
      if (image.processed) URL.revokeObjectURL(image.processed);
    });
    setImages([]);
    toast({
      title: "Images cleared",
      description: "All images have been removed",
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card shadow-[var(--shadow-card)]">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent">
              <ImageIcon className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-card-foreground">
                ID Card Image Processor
              </h1>
              <p className="text-sm text-muted-foreground">
                Upload, process, and download your ID card photos
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-7xl space-y-8">
          {/* Upload Zone */}
          <ImageUploadZone onFilesSelected={handleFilesSelected} />

          {/* Processing Controls */}
          {images.length > 0 && (
            <ProcessingControls
              imageCount={images.length}
              processedCount={images.filter((img) => img.status === "completed").length}
              onProcess={handleProcessImages}
              onClearAll={handleClearAll}
              isProcessing={images.some((img) => img.status === "processing")}
            />
          )}

          {/* Image Grid */}
          {images.length > 0 && (
            <ImageGrid images={images} onRemoveImage={handleRemoveImage} />
          )}

          {/* Empty State */}
          {images.length === 0 && (
            <Card className="border-dashed shadow-[var(--shadow-card)]">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
                  <Upload className="h-10 w-10 text-muted-foreground" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-card-foreground">
                  No images uploaded yet
                </h3>
                <p className="mt-2 text-center text-sm text-muted-foreground">
                  Upload your ID card images to get started with processing
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
};

export default Index;
