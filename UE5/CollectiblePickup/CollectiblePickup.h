// CollectiblePickup.h

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "CollectiblePickup.generated.h"

class APawn;
class USoundBase;
class USphereComponent;
class UStaticMeshComponent;

/**
 * A pickup that spins and bobs in place. When the player walks into it,
 * it adds points to the player's score, plays a sound, and disappears.
 */
UCLASS()
class ACollectiblePickup : public AActor
{
	GENERATED_BODY()

public:
	ACollectiblePickup();

	virtual void Tick(float DeltaTime) override;

protected:
	virtual void BeginPlay() override;

	UFUNCTION()
	void OnOverlapBegin(UPrimitiveComponent* OverlappedComponent, AActor* OtherActor,
		UPrimitiveComponent* OtherComp, int32 OtherBodyIndex, bool bFromSweep, const FHitResult& SweepResult);

	/** Fires right before the pickup is destroyed. Implement it in a Blueprint child for extra effects or UI. */
	UFUNCTION(BlueprintImplementableEvent, Category = "Pickup")
	void OnCollected(APawn* Collector);

	/** Invisible sphere that detects the player walking into the pickup. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Pickup")
	TObjectPtr<USphereComponent> CollisionSphere;

	/** What the pickup looks like. Defaults to the engine cube; swap it in the editor. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Pickup")
	TObjectPtr<UStaticMeshComponent> Mesh;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Pickup")
	int32 Points = 10;

	/** Degrees per second. */
	UPROPERTY(EditAnywhere, Category = "Pickup|Motion")
	float RotationSpeed = 90.f;

	/** How far the mesh moves up and down, in centimeters. */
	UPROPERTY(EditAnywhere, Category = "Pickup|Motion")
	float BobHeight = 20.f;

	UPROPERTY(EditAnywhere, Category = "Pickup|Motion")
	float BobSpeed = 2.f;

	UPROPERTY(EditAnywhere, Category = "Pickup|Effects")
	TObjectPtr<USoundBase> PickupSound;

private:
	FVector MeshStartLocation;
	float RunningTime = 0.f;
};
