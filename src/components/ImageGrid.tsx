import { Download, Trash2, Loader2, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ImageFile } from "@/pages/Index";

interface ImageGridProps {
  images: ImageFile[];
  onRemoveImage: (id: string) => void;
}

const ImageGrid = ({ images, onRemoveImage }: ImageGridProps) => {
  const handleDownload = (image: ImageFile) => {
    const url = image.processed || image.preview;
    const link = document.createElement("a");
    link.href = url;
    link.download = `processed-${image.file.name}`;
    link.click();
  };

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold text-foreground">
        Images ({images.length})
      </h2>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {images.map((image) => (
          <Card
            key={image.id}
            className="group overflow-hidden shadow-[var(--shadow-card)] transition-all duration-300 hover:shadow-[var(--shadow-elevated)]"
          >
            <CardContent className="p-0">
              <div className="relative aspect-square overflow-hidden bg-muted">
                <img
                  src={image.processed || image.preview}
                  alt={image.file.name}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <div className="absolute right-2 top-2">
                  {image.status === "pending" && (
                    <Badge variant="secondary" className="bg-secondary/90 backdrop-blur-sm">
                      Pending
                    </Badge>
                  )}
                  {image.status === "processing" && (
                    <Badge className="bg-primary/90 backdrop-blur-sm">
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      Processing
                    </Badge>
                  )}
                  {image.status === "completed" && (
                    <Badge className="bg-accent/90 backdrop-blur-sm">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      Completed
                    </Badge>
                  )}
                </div>
              </div>
              <div className="p-4">
                <p className="truncate text-sm font-medium text-card-foreground">
                  {image.file.name}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {(image.file.size / 1024).toFixed(1)} KB
                </p>
                <div className="mt-4 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => handleDownload(image)}
                    disabled={image.status !== "completed"}
                  >
                    <Download className="mr-1 h-3 w-3" />
                    Download
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onRemoveImage(image.id)}
                    className="hover:border-destructive hover:bg-destructive hover:text-destructive-foreground"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default ImageGrid;
